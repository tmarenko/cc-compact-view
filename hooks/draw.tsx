import type { EngineInterface, RenderChildren } from 'claude-code'

// The pieces both the one-line results and the run line are drawn with.

type Elements = ReturnType<EngineInterface['ui']['resolve']>

// What the engine draws before a tool result's first line.
export const GUTTER = '  ⎿  '
// Where a row's text starts, past the engine's bullet: a line drawn without one lines up there.
export const TEXT_INDENT = 2

export const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`

// Control, bidi and zero-width characters shown as escapes, so a path stays one honest line.
// biome-ignore lint/complexity/useRegexLiterals: kept as escaped text, the plugin validator rejects raw invisible characters
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g')
export const safe = (text: string) => text.replace(UNSAFE, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

// A summary as a line's words: the change's own (`Updated a.ts`), or a run's (`Updated 3 files`).
export type Line = { verb: string; path?: string; added?: number; removed?: number; lines?: number }

// One dim line: `Updated src/a.ts  +2 −1`, the counts green and red.
export function drawLine({ Text }: Elements, lead: string, s: Line) {
  return (
    <Text dimColor wrap="truncate-middle">
      {lead}
      {s.verb}
      {s.path ? ` ${safe(s.path)}` : ''}
      {s.lines !== undefined && `  ${plural(s.lines, 'line')}`}
      {s.added !== undefined && (
        <Text>
          {'  '}
          <Text color="success">+{s.added}</Text> <Text color="error">−{s.removed ?? 0}</Text>
        </Text>
      )}
    </Text>
  )
}

// A line that acts on a click: dim at rest and brighter under the pointer, as the engine's own
// group line, without the Button's inverted background (a hover style needs a keyed Box around it).
export function clickableLine(
  { Box, Button }: Elements,
  keys: { box: string; button: string },
  onPress: () => void,
  content: RenderChildren,
  indent = 0,
) {
  return (
    <Box key={keys.box} paddingLeft={indent}>
      <Button key={keys.button} plain dimColor hover={{ inverse: false }} onPress={onPress}>
        {content}
      </Button>
    </Box>
  )
}
