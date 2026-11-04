import { expect, test } from 'claude-code/testing'

import type { Row } from './kit'
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
  said,
  toolGroup,
  toolResult,
  toolUse,
  writeCall,
} from './kit'

// e1, e2, w3 in one run; text, e4 alone; text, e5 then a question (not foldable);
// text, then b7 (Bash), r8 (Read), e9 in one run; text, then a failed Bash and e11.
const ROWS: Row[] = [
  prompt(),
  said('', [editCall('e1', 'C:\\proj\\a.ts'), editCall('e2', 'C:\\proj\\a.ts')]),
  results('e2'),
  said('', [writeCall('w3', 'C:\\proj\\n.md')]),
  results('w3'),
  said('Now the other one.', [editCall('e4', 'C:\\proj\\b.ts')]),
  results('e4'),
  said('And this one.', [editCall('e5', 'C:\\proj\\c.ts'), call('a6', 'AskUserQuestion')]),
  results('a6'),
  said('Checking.', [call('b7', 'Bash', { stdout: 'ok' }), call('r8', 'Read'), editCall('e9', 'C:/proj/d.ts')]),
  results('e9'),
  said('Again.', [failedCall('b10', 'Bash'), editCall('e11', 'C:/proj/e.ts')]),
]

test('a run folds into its first row, the rest draw nothing', async ($, on) => {
  engine(on, { rows: ROWS })
  const line = await runLineOf($, toolUse('e1'))
  expect(line).toContain('Updated 1 file, created 1 file')
  expect(line).toContain('+7')
  expect(line).toContain('−2')
  expect(await isBlank($, toolUse('e2'))).toBe(true)
  expect(await isBlank($, toolUse('w3'))).toBe(true)
})

test('a lone edit, or one before another tool, keeps its row', async ($, on) => {
  engine(on, { rows: ROWS })
  expect(await isStock($, toolUse('e4'))).toBe(true)
  expect(await isStock($, toolUse('e5'))).toBe(true)
})

test('a click opens the run into its usual rows, and closes it again', async ($, on) => {
  engine(on, { rows: ROWS })
  const head = await $.ui.mount(toolUse('e1'))
  await head.press({ key: 'fold' })
  expect((await head.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
  const other = await $.ui.mount(toolUse('w3', 'Write'))
  expect((await other.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
  await head.press({ key: 'fold' })
  expect(await head.find({ type: 'Text', text: /stock/ })).toBe(undefined)
  expect(await other.find({ type: 'Text' })).toBe(undefined)
  await other.unmount()
  await head.unmount()
})

test("a folded call's result line draws nothing; a lone one keeps its summary", async ($, on) => {
  engine(on, { rows: ROWS })
  const result = (id: string, path: string) => toolResult(id, 'Edit', { filePath: path, structuredPatch: PATCH })
  expect(await isBlank($, result('e1', 'C:/proj/a.ts'))).toBe(true)
  const ui = await $.ui.mount(result('e4', 'C:/proj/b.ts'))
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated b.ts  +2 −1')
  await ui.unmount()
})

test('a run mixing shell, reads and edits folds into one line, in order', async ($, on) => {
  engine(on, { rows: ROWS })
  expect(await runLineOf($, toolUse('b7', 'Bash'))).toContain('Updated 1 file, ran 1 shell command, read 1 file')
  expect(await isBlank($, toolUse('r8', 'Read'))).toBe(true)
  expect(await isBlank($, toolUse('e9'))).toBe(true)
})

test('a failed call folds into the run, counted with its kind', async ($, on) => {
  engine(on, { rows: ROWS })
  const line = await runLineOf($, toolUse('b10', 'Bash'))
  expect(line).toContain('Updated 1 file, ran 1 shell command')
  expect(line).not.toContain('failed')
  expect(await isBlank($, toolUse('e11'))).toBe(true)
  // Its error line is hidden with the run.
  expect(await isBlank($, toolResult('b10', 'Bash', 'Exit 1', { isErrored: true }))).toBe(true)
})

test("the engine's own group line folds when it sits inside a run", async ($, on) => {
  engine(on, { rows: ROWS })
  expect(
    await runLineOf(
      $,
      toolGroup([
        ['b7', 'Bash'],
        ['r8', 'Read'],
      ]),
    ),
  ).toContain('ran 1 shell command, read 1 file')
  expect(await isBlank($, toolGroup([['r8', 'Read']]))).toBe(true)
})

test("an open run keeps its line when the engine's own click expands its group", async ($, on) => {
  engine(on, { rows: ROWS })
  const group = (isExpanded: boolean) =>
    toolGroup(
      [
        ['b7', 'Bash'],
        ['r8', 'Read'],
      ],
      isExpanded,
    )
  // Closed and expanded (--verbose): drawn in full by the engine.
  expect(await runLineOf($, group(true))).toBe(undefined)
  const ui = await $.ui.mount(group(false))
  await ui.press({ key: 'fold' })
  await ui.unmount()
  // Open: the run's line stays over the group's rows, whatever the engine's own flag says.
  const open = await $.ui.mount(group(true))
  expect((await open.find({ type: 'Button' }))?.text).toContain('ran 1 shell command, read 1 file')
  expect((await open.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
  await open.unmount()
})
