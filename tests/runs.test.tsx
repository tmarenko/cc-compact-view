import { expect, test } from 'claude-code/testing'

import {
  call,
  editCall,
  engine,
  failedCall,
  isBlank,
  isStock,
  PATCH,
  prompt,
  results,
  runLineOf,
  runningCall,
  said,
  toolGroup,
  toolResult,
  toolUse,
} from './kit'

const bash = (id: string) => call(id, 'Bash', { stdout: 'ok' })

test('a thinking update shown between calls ends the run', async ($, on) => {
  engine(on, {
    rows: [
      prompt(),
      said('', [editCall('e1'), editCall('e2')]),
      results('e1', 'e2'),
      said('', [editCall('e3'), editCall('e4')], 'The render needs about 5 minutes.'),
    ],
  })
  // e3 heads its own run: it draws a run line, not nothing.
  expect(await runLineOf($, toolUse('e3'))).toContain('Updated 2 files')
})

test('an empty thinking block does not end the run', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1')]), results('e1'), said('', [editCall('e2')], '')] })
  expect(await isBlank($, toolUse('e2'))).toBe(true)
})

test('a running call keeps its row; it folds once finished', async ($, on) => {
  let isDone = false
  engine(on, {
    rows: () => [
      prompt(),
      said('', [editCall('e1')]),
      results('e1'),
      said('', [isDone ? bash('b2') : runningCall('b2', 'Bash')]),
    ],
  })
  on('tool.call', () => ({ result: { stdout: 'ok' } }) as never)
  expect(await isStock($, toolUse('b2', 'Bash', true))).toBe(true)
  expect(await isStock($, toolUse('e1'))).toBe(true)
  // It finishes: the call is recorded and the transcript read again.
  isDone = true
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'sleep 300' } as never)
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 1 file, ran 1 shell command')
  expect(await isBlank($, toolUse('b2', 'Bash'))).toBe(true)
})

test('a group the transcript splits draws as usual, and the mod stays on', async ($, on) => {
  const { shown } = engine(on, {
    rows: [
      prompt(),
      said('', [call('r1', 'Read'), bash('b2')]),
      results('r1', 'b2'),
      said('Next.', [bash('b3'), editCall('e4')]),
    ],
  })
  // The engine grouped b2 and b3 although text sits between them in the transcript.
  expect(
    await isStock(
      $,
      toolGroup([
        ['b2', 'Bash'],
        ['b3', 'Bash'],
      ]),
    ),
  ).toBe(true)
  expect(shown).toHaveLength(0)
  // r1 alone is left of its run: no fold, its row draws as usual.
  expect(await isStock($, toolUse('r1', 'Read'))).toBe(true)
  // A group holding a running call draws as usual too.
  expect(
    await isStock(
      $,
      toolGroup([
        ['b3', 'Bash'],
        ['e4', 'Edit', true],
      ]),
    ),
  ).toBe(true)
  expect(shown).toHaveLength(0)
})

test('an open run has a line under its last call that closes it', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), editCall('e2'), editCall('e3')])] })
  const result = (id: string) => toolResult(id, 'Edit', { filePath: `C:/proj/${id}.ts`, structuredPatch: PATCH })
  const head = await $.ui.mount(toolUse('e1'))
  await head.press({ key: 'fold' })
  // Only the last call's result carries it.
  const middle = await $.ui.mount(result('e2'))
  expect(await middle.find({ type: 'Button', text: /Collapse/ })).toBe(undefined)
  await middle.unmount()
  const last = await $.ui.mount(result('e3'))
  expect((await last.find({ type: 'Button', text: /Collapse/ }))?.text).toContain('Collapse: updated 3 files')
  expect((await last.find({ type: 'Text', text: /Updated/ }))?.text).toContain('e3.ts  +2 −1')
  await last.press({ key: 'fold-end' })
  expect(await last.find({ type: 'Text' })).toBe(undefined)
  expect((await head.find({ type: 'Button' }))?.text).toContain('Updated 3 files')
  expect(await head.find({ type: 'Text', text: /stock/ })).toBe(undefined)
  await last.unmount()
  await head.unmount()
})

test('an engine group holding a failed command folds into one line with the rest', async ($, on) => {
  engine(on, {
    rows: [prompt(), said('', [editCall('e1'), bash('b2'), failedCall('b3', 'Bash'), bash('b4'), editCall('e5')])],
  })
  // Not the head: the group draws nothing, the run's line is above it.
  expect(
    await isBlank(
      $,
      toolGroup([
        ['b2', 'Bash'],
        ['b3', 'Bash', false, true],
        ['b4', 'Bash'],
      ]),
    ),
  ).toBe(true)
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 2 files, ran 3 shell commands')
})

test('subagent launches and MCP calls fold into the run; a running agent keeps its row', async ($, on) => {
  const agent = (id: string) => call(id, 'Agent', { status: 'async_launched' })
  const mcp = call('m5', 'mcp__claude-mem__work_state_write')
  engine(on, {
    rows: [prompt(), said('', [editCall('e1'), bash('b2'), agent('a3'), agent('a4'), mcp, runningCall('a7', 'Agent')])],
  })
  expect(await runLineOf($, toolUse('e1'))).toContain(
    'Updated 1 file, ran 1 shell command, launched 2 agents, called 1 MCP tool',
  )
  expect(await isBlank($, toolUse('a3', 'Agent'))).toBe(true)
  expect(await isBlank($, toolUse('m5', mcp.tool))).toBe(true)
  expect(await isStock($, toolUse('a7', 'Agent', true))).toBe(true)
})

test('a question to the person still ends the run', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), call('q2', 'AskUserQuestion'), editCall('e3')])] })
  expect(await isStock($, toolUse('q2', 'AskUserQuestion'))).toBe(true)
  expect(await isStock($, toolUse('e1'))).toBe(true)
})

test("a subagent's own runs fold, read from its transcript", async ($, on) => {
  // The main conversation knows nothing of the subagent's calls.
  engine(on, {
    rows: [prompt()],
    agents: { 'agent-1': [prompt('task for the agent'), said('', [editCall('s1'), bash('s2'), bash('s3')])] },
  })
  on(
    'tool.call',
    (_, e) => ({ result: (e as { tool: string }).tool === 'Edit' ? editCall('x').result : { stdout: 'ok' } }) as never,
  )
  for (const [id, tool] of [
    ['s1', 'Edit'],
    ['s2', 'Bash'],
    ['s3', 'Bash'],
  ]) {
    await $.tool.call({
      tool,
      tool_use_id: id,
      agentId: 'agent-1',
      command: 'make',
      file_path: 'C:/proj/a.ts',
      old_string: 'a',
      new_string: 'b',
    } as never)
  }
  expect(await runLineOf($, toolUse('s1'))).toContain('Updated 1 file, ran 2 shell commands')
  expect(await isBlank($, toolUse('s2', 'Bash'))).toBe(true)
})

test('a command first drawn in a live group folds once it finishes and gets its own row', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [bash('b1'), bash('b2'), bash('b3')])] })
  // While b1 ran, the engine drew it in a live group (that group is never drawn again).
  expect(await isStock($, toolGroup([['b1', 'Bash', true]]))).toBe(true)
  // Finished, it changed files and the engine drew it standalone, the rest in a group.
  expect(await runLineOf($, toolUse('b1', 'Bash'))).toContain('Ran 3 shell commands')
  expect(
    await isBlank(
      $,
      toolGroup([
        ['b2', 'Bash'],
        ['b3', 'Bash'],
      ]),
    ),
  ).toBe(true)
})
