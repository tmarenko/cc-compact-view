import { expect, test } from 'claude-code/testing'

import type { Row } from './kit'
import { editCall, engine, isStock, prompt, runCommand, runLineOf, said, startSession, toolUse } from './kit'

const ROWS: Row[] = [prompt(), said('', [editCall('e1'), editCall('e2'), editCall('e3')])]

// The transcript read fails until `fix()` is called.
function failingRows() {
  let isFailing = true
  return {
    rows: () => {
      if (isFailing) throw new Error('transcript unreadable')
      return ROWS
    },
    fix: () => {
      isFailing = false
    },
  }
}

test('an error draws the stock row, says so once, and keeps every later row stock', async ($, on) => {
  const { rows, fix } = failingRows()
  const { shown } = engine(on, { rows })
  expect(await isStock($, toolUse('e2'))).toBe(true)
  expect(shown).toHaveLength(1)
  expect(shown[0]).toContain('turned itself off')

  // The transcript reads again, but the mod stays off: no row of the run hides.
  fix()
  for (const id of ['e1', 'e2', 'e3']) expect(await isStock($, toolUse(id))).toBe(true)
  expect(shown).toHaveLength(1)
})

test('/compact-view reports the error; /compact-view on folds again', async ($, on) => {
  const { rows, fix } = failingRows()
  engine(on, { rows })
  await startSession($, on)
  await isStock($, toolUse('e1'))

  expect(await runCommand($, '')).toContain('off for this session after an error: drawing a tool row')

  fix()
  expect(await runCommand($, 'on')).toContain('cc-compact-view on')
  expect(await runLineOf($, toolUse('e1'))).toContain('Updated 3 files')
})
