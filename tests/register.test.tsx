import { expect, test } from 'claude-code/testing'

import { engine, isStock, PATCH, runCommand, startSession, toolResult } from './kit'

let next = 0
// A result row of its own: a fresh id each, so no click or first drawing carries over.
const result = (tool: string, output: unknown, extra = {}) => toolResult(`id-${next++}`, tool, output, extra)

test('an Edit draws one line with its counts and relative path', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { filePath: 'C:\\proj\\src\\a.ts', structuredPatch: PATCH }))
  const row = await ui.find({ type: 'Text', text: /Updated/ })
  expect(row?.text).toBe('  ⎿  Updated src\\a.ts  +2 −1')
  expect(await ui.find({ type: 'Text', text: /stock/ })).toBe(undefined)
  await ui.unmount()
})

test('a new file counts its lines', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(
    result('Write', { type: 'create', filePath: 'C:/proj/n.md', content: 'x\ny\nz\n', structuredPatch: [] }),
  )
  expect((await ui.find({ type: 'Text', text: /Created/ }))?.text).toBe('  ⎿  Created n.md  3 lines')
  await ui.unmount()
})

test('review-held edits, errors and ctrl+o keep the stock diff', async ($, on) => {
  engine(on)
  const cases = [
    result('Edit', { filePath: 'C:/proj/a.ts', structuredPatch: PATCH, staged: true }),
    result('Edit', 'boom', { isErrored: true }),
    result('Edit', { filePath: 'C:/proj/a.ts', structuredPatch: PATCH }, { isErrored: true }),
    result('Edit', { filePath: 'C:/proj/a.ts', structuredPatch: PATCH }, { isExpanded: true }),
    result('Read', { file: {} }),
  ]
  for (const c of cases) expect(await isStock($, c)).toBe(true)
})

test('a Bash that changed files keeps its output and lists the files', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(
    result('Bash', {
      stdout: 'done',
      stderr: '',
      bashEditDiff: { files: [{ filePath: 'C:/proj/b.py', hunks: PATCH }], moreFiles: 2 },
    }),
  )
  expect((await ui.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
  expect((await ui.find({ type: 'Text', text: /b\.py/ }))?.text).toBe('  ⎿  Updated b.py  +2 −1')
  expect((await ui.find({ type: 'Text', text: /more/ }))?.text).toBe('  ⎿  … 2 more files')
  await ui.unmount()
})

test('a plain Bash is untouched', async ($, on) => {
  engine(on)
  expect(await isStock($, result('Bash', { stdout: 'hi', stderr: '' }))).toBe(true)
})

test('saved off draws the stock diff; /compact-view on switches back', async ($, on) => {
  engine(on, { store: { enabled: false } })
  await startSession($, on)

  const edit = { filePath: 'C:/proj/a.ts', structuredPatch: PATCH }
  expect(await isStock($, result('Edit', edit))).toBe(true)

  expect(await runCommand($, 'on')).toContain('cc-compact-view on')

  const ui = await $.ui.mount(result('Edit', edit))
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated a.ts  +2 −1')
  await ui.unmount()
})

test('a click on the one-line result shows the full diff under it, another hides it', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { filePath: 'C:/proj/src/a.ts', structuredPatch: PATCH }))
  await ui.press({ key: 'diff-file' })
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('  ⎿  Updated src/a.ts  +2 −1')
  expect((await ui.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
  await ui.press({ key: 'diff-file' })
  expect(await ui.find({ type: 'Text', text: /stock/ })).toBe(undefined)
  await ui.unmount()
})

test('one-line results draw on every surface, with the gutter on the terminal only', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const component = result('Edit', { filePath: 'C:/proj/a.ts', structuredPatch: PATCH }) as { surface: string }
    const ui = await $.ui.mount({ ...component, surface } as never)
    const lead = surface === 'terminal' ? '  ⎿  ' : ''
    expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe(`${lead}Updated a.ts  +2 −1`)
    await ui.press({ key: 'diff-file' })
    expect((await ui.find({ type: 'Text', text: /stock/ }))?.text).toBe('stock row')
    await ui.unmount()
  }
})
