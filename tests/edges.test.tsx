import { expect, test } from 'claude-code/testing'

import {
  agentCall,
  call,
  editCall,
  engine,
  isBlank,
  isStock,
  onMainScreen,
  PATCH,
  prompt,
  results,
  runLineOf,
  said,
  subagentCall,
  toolGroup,
  toolResult,
  toolUse,
} from './kit'

// Cases that once hid rows, drew the wrong counts, or read the transcript too often.

const bash = (id: string, result: unknown = { stdout: 'ok' }) => call(id, 'Bash', result)

test('a row drawn while a stock group decides again still draws', async ($, on) => {
  // r1, b2 | text | b3, e4: the engine groups b2 and b3 across the text, so that group draws as usual.
  engine(on, {
    rows: [
      prompt(),
      said('', [call('r1', 'Read'), bash('b2')]),
      results('r1', 'b2'),
      said('Next.', [bash('b3'), editCall('e4')]),
    ],
  })
  const group = () =>
    toolGroup([
      ['b2', 'Bash'],
      ['b3', 'Bash'],
    ])
  expect(await isStock($, group())).toBe(true)
  // A state write redraws every row at once: the group and e4 draw together, in either order.
  const [, e4] = await Promise.all([isStock($, group()), isStock($, toolUse('e4'))])
  expect(e4).toBe(true)
  const [e4Again] = await Promise.all([isStock($, toolUse('e4')), isStock($, group())])
  expect(e4Again).toBe(true)
})

test("a subagent's run folds without its calls seen made, found through the Agent call", async ($, on) => {
  engine(on, {
    rows: [prompt(), said('', [agentCall('a1', 'agent-1')])],
    agents: {
      'agent-1': [
        prompt('task'),
        said('', [
          subagentCall('s1', 'Edit', { file_path: 'C:/proj/x.ts' }),
          subagentCall('s2', 'Bash'),
          subagentCall('s3', 'Bash'),
        ]),
      ],
    },
  })
  expect(await runLineOf($, toolUse('s1'))).toContain('Updated 1 file, ran 2 shell commands')
  expect(await isBlank($, toolUse('s2', 'Bash'))).toBe(true)
})

test("a subagent's run whose first call no transcript places keeps every row", async ($, on) => {
  // agent-1's calls were seen made but its first call's record is long gone, and the main
  // transcript names no agent (compacted away): the first row can't find its run.
  engine(on, {
    rows: [prompt()],
    agents: { 'agent-1': [prompt('task'), said('', [editCall('s1'), bash('s2'), bash('s3')])] },
  })
  on('tool.call', () => ({ result: { stdout: 'ok' } }) as never)
  const make = (id: string, agentId: string) =>
    $.tool.call({ tool: 'Bash', tool_use_id: id, agentId, command: 'x' } as never)
  for (const id of ['s1', 's2', 's3']) await make(id, 'agent-1')
  // 499 more: only the oldest record, s1's, drops.
  for (let i = 0; i < 499; i++) await make(`x${i}`, 'agent-2')
  expect(await isStock($, toolUse('s1'))).toBe(true)
  expect(await isStock($, toolUse('s2', 'Bash'))).toBe(true)
})

test('a closed run whose group was left expanded shows every row', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [bash('b1'), bash('b2'), editCall('e3')])] })
  // The engine's own flag, left set by a click on a row inside the group.
  const group = toolGroup(
    [
      ['b1', 'Bash'],
      ['b2', 'Bash'],
    ],
    true,
  )
  expect(await isStock($, group)).toBe(true)
  expect(await isStock($, toolUse('e3'))).toBe(true)
})

test('a group holding a row that is no call (recalled memory, hook timing) draws as usual', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), bash('b2'), bash('b3')])] })
  const group = {
    ...(toolGroup([
      ['b2', 'Bash'],
      ['b3', 'Bash'],
    ]) as { props: object }),
  }
  group.props = { ...group.props, isCallsOnly: false }
  expect(await isStock($, group)).toBe(true)
  expect(await isStock($, toolUse('e1'))).toBe(true)
})

test('on the main screen runs never fold; one-line results still draw', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), editCall('e2')])] })
  expect(await isStock($, onMainScreen(toolUse('e1')))).toBe(true)
  expect(await isStock($, onMainScreen(toolUse('e2')))).toBe(true)
  const ui = await $.ui.mount(
    onMainScreen(toolResult('e2', 'Edit', { filePath: 'C:/proj/e2.ts', structuredPatch: PATCH })),
  )
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated e2.ts  +2 −1')
  await ui.unmount()
})

test('ctrl+o shows no Collapse line under an open run', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), editCall('e2')])] })
  const head = await $.ui.mount(toolUse('e1'))
  await head.press({ key: 'fold' })
  await head.unmount()
  const result = toolResult('e2', 'Edit', { filePath: 'C:/proj/e2.ts', structuredPatch: PATCH }, { isExpanded: true })
  expect(await isStock($, result)).toBe(true)
  expect(await runLineOf($, result)).toBe(undefined)
})

test('a Write that changed nothing counts nothing, whatever git says of the file', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(
    toolResult('w9', 'Write', {
      type: 'update',
      filePath: 'C:/proj/a.ts',
      content: 'same',
      originalFile: 'same',
      structuredPatch: [],
      gitDiff: { filename: 'a.ts', status: 'modified', additions: 40, deletions: 3, changes: 43, patch: '' },
    }),
  )
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated a.ts  +0 −0')
  await ui.unmount()
})

test('every file a command changed counts, shown in its diff or not', async ($, on) => {
  const diff = {
    files: [{ filePath: 'C:/proj/a.ts', hunks: PATCH }],
    moreFiles: 2,
    changedFiles: ['C:/proj/a.ts', 'C:/proj/b.ts', 'C:/proj/c.ts'],
  }
  engine(on, { rows: [prompt(), said('', [bash('b1', { stdout: 'ok', bashEditDiff: diff }), editCall('e2')])] })
  expect(await runLineOf($, toolUse('b1', 'Bash'))).toContain('Updated 4 files, ran 1 shell command')
})

test('one file is counted once, however its path is written', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1', 'C:\\proj\\a.ts'), editCall('e2', 'c:/proj/A.ts')])] })
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 1 file  +4 −2')
})

test('a notebook edit that failed draws as usual', async ($, on) => {
  engine(on)
  const result = toolResult('n1', 'NotebookEdit', {
    notebook_path: 'C:/proj/a.ipynb',
    cell_id: 'c1',
    edit_mode: 'replace',
    error: 'Cell not found',
  })
  expect(await isStock($, result)).toBe(true)
})

test('tool searches, code lookups and MCP resource reads fold with the rest', async ($, on) => {
  engine(on, {
    rows: [
      prompt(),
      said('', [editCall('e1'), call('t2', 'ToolSearch'), call('l3', 'LSP'), call('m4', 'ReadMcpResourceTool')]),
    ],
  })
  expect(await runLineOf($, toolUse('e1'))).toContain(
    'Updated 1 file, made 1 code lookup, ran 1 tool search, called 1 MCP tool',
  )
})

test('rows the transcript lacks read it again once a tick, not once a row', async ($, on) => {
  const { counts } = engine(on, { rows: [prompt(), said('', [editCall('e1'), editCall('e2')])] })
  for (let i = 0; i < 20; i++) await isStock($, toolUse(`gone${i}`))
  // The first read, and one more for the first row it lacked: two forms each.
  expect(counts.reads).toBeLessThanOrEqual(4)
})

test('/compact-view off draws earlier one-line results the usual way at once', async ($, on) => {
  engine(on)
  const result = toolResult('e1', 'Edit', { filePath: 'C:/proj/a.ts', structuredPatch: PATCH })
  expect(await isStock($, result)).toBe(false)
  await $.command.run({ command: 'compact-view', args: 'off' } as never)
  expect(await isStock($, result)).toBe(true)
})
