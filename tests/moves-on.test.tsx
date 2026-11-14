import { expect, test } from 'claude-code/testing'

import type { Row } from './kit'
import {
  agentCall,
  appended,
  call,
  editCall,
  engine,
  isBlank,
  isStock,
  moveOn,
  PATCH,
  prompt,
  results,
  runLineOf,
  said,
  spinner,
  toolGroup,
  toolResult,
  toolUse,
} from './kit'

// A run folds once the conversation has moved on past it: Claude's reply beginning, its text
// reaching the transcript, or the next prompt. Until then its rows stay where they were drawn,
// rather than folding away one by one while the run grows.

const bash = (id: string) => call(id, 'Bash', { stdout: 'ok' })

test('a run that is the last thing drawn keeps every row and its one-line results', async ($, on) => {
  engine(on, { rows: [prompt(), said('', [editCall('e1'), bash('b2'), editCall('e3')])] })
  expect(await isStock($, toolUse('e1'))).toBe(true)
  expect(await isStock($, toolUse('b2', 'Bash'))).toBe(true)
  expect(await isStock($, toolUse('e3'))).toBe(true)
  const ui = await $.ui.mount(toolResult('e3', 'Edit', { filePath: 'C:/proj/e3.ts', structuredPatch: PATCH }))
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated e3.ts  +2 −1')
  expect(await ui.find({ type: 'Button', text: /Collapse/ })).toBe(undefined)
  await ui.unmount()
})

test("Claude's text reaching the transcript folds the run above it; a tool result doesn't", async ($, on) => {
  const rows: Row[] = [prompt(), said('', [editCall('e1'), editCall('e2')])]
  engine(on, { rows: () => rows })
  expect(await isStock($, toolUse('e1'))).toBe(true)
  // The transcript already holds the text, but only a row that draws something reads it again.
  rows.push(results('e1', 'e2'), moveOn())
  await $.session.append(appended('tool-result', 'e2'))
  expect(await isStock($, toolUse('e1'))).toBe(true)
  await $.session.append(appended('response', 'Done.'))
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 2 files')
  expect(await isBlank($, toolUse('e2'))).toBe(true)
})

test('your next message folds a run the turn ended on', async ($, on) => {
  const rows: Row[] = [prompt(), said('', [editCall('e1'), editCall('e2')])]
  engine(on, { rows: () => rows })
  expect(await isStock($, toolUse('e2'))).toBe(true)
  rows.push(results('e1', 'e2'), prompt('next'))
  await $.session.append(appended('prompt', 'next'))
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 2 files')
  expect(await isBlank($, toolUse('e2'))).toBe(true)
})

test("Claude's reply beginning folds the run before its text is in the transcript", async ($, on) => {
  engine(on, { rows: [prompt(), said('', [bash('b1'), bash('b2')])] })
  on('tool.call', () => ({ result: { stdout: 'ok' } }) as never)
  for (const id of ['b1', 'b2']) await $.tool.call({ tool: 'Bash', tool_use_id: id, command: 'make' } as never)
  // Still working: the rows stay.
  expect(await isStock($, spinner('tool-use'))).toBe(true)
  expect(await isStock($, spinner('thinking'))).toBe(true)
  expect(await isStock($, toolUse('b1', 'Bash'))).toBe(true)
  // The reply begins: the spinner draws as usual, and the run folds.
  expect(await isStock($, spinner('responding'))).toBe(true)
  expect(await runLineOf($, toolUse('b1', 'Bash'))).toContain('Ran 2 shell commands')
  expect(await isBlank($, toolUse('b2', 'Bash'))).toBe(true)
})

test('each reply folds only the runs before it', async ($, on) => {
  engine(on, {
    rows: [prompt(), said('', [bash('b1'), bash('b2')]), results('b1', 'b2'), said('Next.', [bash('b3'), bash('b4')])],
  })
  on('tool.call', () => ({ result: { stdout: 'ok' } }) as never)
  const make = (id: string) => $.tool.call({ tool: 'Bash', tool_use_id: id, command: 'make' } as never)
  await make('b1')
  await make('b2')
  await isStock($, spinner('responding'))
  await make('b3')
  await make('b4')
  // b1 and b2 sit above the reply's text; b3 and b4 were made after it began.
  expect(await runLineOf($, toolUse('b1', 'Bash'))).toContain('Ran 2 shell commands')
  expect(await isStock($, toolUse('b3', 'Bash'))).toBe(true)
  expect(await isStock($, toolUse('b4', 'Bash'))).toBe(true)
  await isStock($, spinner('responding'))
  expect(await runLineOf($, toolUse('b3', 'Bash'))).toContain('Ran 2 shell commands')
  expect(await isBlank($, toolUse('b4', 'Bash'))).toBe(true)
})

test('a finished group in a growing run draws as usual, then folds with the run', async ($, on) => {
  const rows: Row[] = [prompt(), said('', [editCall('e1'), bash('b2'), bash('b3')])]
  engine(on, { rows: () => rows })
  const group = toolGroup([
    ['b2', 'Bash'],
    ['b3', 'Bash'],
  ])
  expect(await isStock($, group)).toBe(true)
  expect(await isStock($, toolUse('e1'))).toBe(true)
  rows.push(results('e1', 'b2', 'b3'), moveOn())
  await $.session.append(appended('response', 'Done.'))
  // The row above the group draws first: the group's calls must not have been kept out of the run.
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 1 file, ran 2 shell commands')
  expect(await isBlank($, group)).toBe(true)
})

test("a subagent's run waits for the subagent's own text, not the main reply", async ($, on) => {
  const agentRows: Row[] = [prompt('task'), said('', [editCall('s1'), bash('s2'), bash('s3')])]
  engine(on, { rows: [prompt(), said('', [agentCall('a1', 'agent-1')])], agents: { 'agent-1': agentRows } })
  on(
    'tool.call',
    (_, e) => ({ result: (e as { tool: string }).tool === 'Edit' ? editCall('x').result : { stdout: 'ok' } }) as never,
  )
  const inAgent = (id: string, tool: string) =>
    $.tool.call({ tool, tool_use_id: id, agentId: 'agent-1', command: 'make', file_path: 'C:/proj/a.ts' } as never)
  await inAgent('s1', 'Edit')
  await inAgent('s2', 'Bash')
  await inAgent('s3', 'Bash')
  await $.tool.call({ tool: 'Agent', tool_use_id: 'a1', prompt: 'task' } as never)
  await isStock($, spinner('responding'))
  expect(await isStock($, toolUse('s1'))).toBe(true)
  expect(await isStock($, toolUse('s2', 'Bash'))).toBe(true)
  // The subagent writes its answer: its run is over.
  agentRows.push(results('s1', 's2', 's3'), moveOn())
  await $.session.append(appended('response', 'Done.', 'agent-1'))
  expect(await runLineOf($, toolUse('s1'))).toContain('Updated 1 file, ran 2 shell commands')
  expect(await isBlank($, toolUse('s3', 'Bash'))).toBe(true)
})
