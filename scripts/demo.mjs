// Writes docs/demo.svg: an animated terminal showing a turn in which each finished tool call
// folds into the run's one line. Mocked data, drawn the way the mod draws it.
//   node scripts/demo.mjs                  the animation
//   node scripts/demo.mjs --frame 3 <out>  one frame, still (to preview)

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Sized to the longest line and the tallest frame.
const WIDTH = 800
const HEIGHT = 284
const TITLE_BAR = 34
const PAD_X = 24
const FIRST_LINE = 72
const LINE = 22
const FONT = 14
// How far below a line's top its text baseline sits, so a background box centres the text.
const PROMPT_BASELINE = 3

const COLOR = {
  bg: '#1c1c1c',
  bar: '#2a2a2a',
  text: '#e8e8e8',
  dim: '#8b8b8b',
  green: '#4eba65',
  red: '#ff6b80',
  yellow: '#f5c451',
  orange: '#d97757',
  shine: '#ffcfbd',
  promptBg: '#373737',
}

// Claude Code's spinner: its glyphs forward then back, one step each SPIN_STEP seconds,
// while a highlight sweeps across the verb.
const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const SPIN_STEP = 0.12
const SHINE_SECONDS = 1.8
const SHINE_STAGGER = 0.07

// A line is a list of segments [text, color, isBold?, cssClass?], or a spinner { verb }.
// A line marked `isPrompt` is what the person typed: drawn on a background, as Claude Code does.
const blank = []
const prompt = Object.assign(
  [
    ['> ', COLOR.dim],
    ['add input validation to the signup form', COLOR.text],
  ],
  { isPrompt: true },
)
const said = text => [
  ['● ', COLOR.text],
  [text, COLOR.text],
]
// A tool row: a running call's bullet blinks until it finishes.
const toolRow = (name, arg, isRunning) => [
  isRunning ? ['● ', COLOR.dim, false, 'blink'] : ['● ', COLOR.green],
  [name, COLOR.text, true],
  [`(${arg})`, COLOR.text],
]
const running = (name, arg) => toolRow(name, arg, true)
const result = text => [
  ['  ⎿  ', COLOR.dim],
  [text, COLOR.dim],
]
const runLine = (words, added, removed) => [
  [`  ${words}`, COLOR.dim],
  [`  +${added}`, COLOR.green],
  [` −${removed}`, COLOR.red],
]
const spinner = verb => ({ verb })

const start = said("I'll add the checks, cover them with tests, and check the docs on the way.")
// The turn up to a point: what sits above the moving part.
const turn = (...rest) => [prompt, blank, start, blank, ...rest]

// Each frame: what the transcript shows, and for how many seconds.
const FRAMES = [
  { seconds: 0.9, lines: [prompt, blank, spinner('Thinking')] },
  { seconds: 0.9, lines: turn(running('Read', 'src/signup.ts'), blank, spinner('Reading')) },
  // Finished but alone: one call is no run yet, so it keeps its row.
  {
    seconds: 0.8,
    lines: turn(toolRow('Read', 'src/signup.ts'), result('Read 84 lines'), blank, spinner('Editing')),
  },
  { seconds: 0.8, lines: turn(runLine('Updated 1 file, read 1 file', 12, 2), blank, spinner('Editing')) },
  {
    seconds: 0.8,
    lines: turn(runLine('Updated 1 file, created 1 file, read 1 file', 40, 2), blank, spinner('Writing')),
  },
  {
    seconds: 0.8,
    lines: turn(runLine('Updated 2 files, created 2 files, read 1 file', 96, 5), blank, spinner('Writing')),
  },
  {
    seconds: 1.6,
    lines: turn(
      runLine('Updated 2 files, created 2 files, read 1 file', 96, 5),
      blank,
      running('Bash', 'npm test'),
      result('Running… (ctrl+b to run in background)'),
      blank,
      spinner('Testing'),
    ),
  },
  {
    seconds: 0.8,
    lines: turn(
      runLine('Updated 2 files, created 2 files, ran 1 shell command, read 1 file', 96, 5),
      blank,
      spinner('Linting'),
    ),
  },
  {
    seconds: 0.8,
    lines: turn(
      runLine('Updated 2 files, created 2 files, ran 2 shell commands, read 1 file', 96, 5),
      blank,
      spinner('Checking docs'),
    ),
  },
  {
    seconds: 0.8,
    lines: turn(
      runLine('Updated 2 files, created 2 files, ran 2 shell commands, read 1 file, called 1 MCP tool', 96, 5),
      blank,
      spinner('Wrapping up'),
    ),
  },
  {
    seconds: 3.0,
    lines: turn(
      runLine('Updated 2 files, created 2 files, ran 2 shell commands, read 1 file, called 1 MCP tool', 96, 5),
      blank,
      said('Done: email and password checks in src/validators.ts, 9 new tests, all passing.'),
    ),
  },
]

const xmlText = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function drawSpinner(verb, y) {
  const glyphs = GLYPHS.map(
    (g, i) =>
      `<text x="${PAD_X}" y="${y}" fill="${COLOR.orange}" class="spin" style="animation-delay:${(-(GLYPHS.length - i) * SPIN_STEP).toFixed(2)}s">${g}</text>`,
  ).join('')
  const letters = [...`${verb}…`]
    .map(
      (c, i) => `<tspan class="shine" style="animation-delay:${(i * SHINE_STAGGER).toFixed(2)}s">${xmlText(c)}</tspan>`,
    )
    .join('')
  return `${glyphs}<text x="${PAD_X}" y="${y}" fill="${COLOR.orange}">  ${letters}<tspan fill="${COLOR.dim}"> (esc to interrupt)</tspan></text>`
}

function drawFrame(lines) {
  return lines
    .map((line, i) => {
      const y = FIRST_LINE + i * LINE
      if (!Array.isArray(line)) return drawSpinner(line.verb, y)
      if (line.length === 0) return ''
      const spans = line
        .map(
          ([text, color, isBold, cls]) =>
            `<tspan fill="${color}"${isBold ? ' font-weight="bold"' : ''}${cls ? ` class="${cls}"` : ''}>${xmlText(text)}</tspan>`,
        )
        .join('')
      const text = `<text x="${PAD_X}" y="${y}">${spans}</text>`
      if (!line.isPrompt) return text
      // The background spans the line's full width and height, the text centred in it.
      const top = y - LINE + PROMPT_BASELINE
      return `<rect x="${PAD_X - 8}" y="${top}" width="${WIDTH - 2 * (PAD_X - 8)}" height="${LINE + 4}" rx="3" fill="${COLOR.promptBg}"/>${text}`
    })
    .join('')
}

// The frames take turns: each visible from its start to its end, hidden the rest of the loop.
function timeline() {
  const total = FRAMES.reduce((n, f) => n + f.seconds, 0)
  const pct = s => `${((s / total) * 100).toFixed(3)}%`
  let at = 0
  const rules = FRAMES.map((frame, i) => {
    const from = at
    at += frame.seconds
    const visible = from === 0 ? `0%{opacity:1}` : `0%{opacity:0}${pct(from)}{opacity:1}`
    const isLast = at >= total
    return `.f${i}{animation:f${i} ${total}s step-end infinite}@keyframes f${i}{${visible}${isLast ? '' : `${pct(at)}{opacity:0}`}100%{opacity:${isLast ? 1 : 0}}}`
  })
  const cycle = GLYPHS.length * SPIN_STEP
  const glyph = `.spin{opacity:0;animation:spin ${cycle}s step-end infinite}@keyframes spin{0%{opacity:1}${((1 / GLYPHS.length) * 100).toFixed(3)}%{opacity:0}}`
  const shine = `.shine{animation:shine ${SHINE_SECONDS}s linear infinite}@keyframes shine{0%,30%,100%{fill:${COLOR.orange}}15%{fill:${COLOR.shine}}}`
  const blink = '.blink{animation:blink 1s step-end infinite}@keyframes blink{50%{fill-opacity:0}}'
  const last = FRAMES.length - 1
  const still = `@media (prefers-reduced-motion:reduce){.f,.spin,.shine,.blink{animation:none}.f{opacity:0}.f${last}{opacity:1}}`
  return rules.join('') + glyph + shine + blink + still
}

function svg(onlyFrame) {
  const frames = FRAMES.map((frame, i) => {
    if (onlyFrame !== undefined && i !== onlyFrame) return ''
    const style = onlyFrame === undefined ? ` class="f f${i}" opacity="0"` : ''
    return `<g${style}>${drawFrame(frame.lines)}</g>`
  }).join('')
  const dots = [COLOR.red, COLOR.yellow, COLOR.green]
    .map((c, i) => `<circle cx="${20 + i * 20}" cy="${TITLE_BAR / 2}" r="6" fill="${c}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title">
<title id="title">cc-compact-view: a Claude Code turn whose tool calls fold into one summary line as they finish</title>
<style>${timeline()}text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT}px;white-space:pre}</style>
<rect width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${COLOR.bg}"/>
<path d="M0 10a10 10 0 0 1 10-10h${WIDTH - 20}a10 10 0 0 1 10 10v${TITLE_BAR - 10}h-${WIDTH}z" fill="${COLOR.bar}"/>
${dots}
<text x="${WIDTH / 2}" y="${TITLE_BAR / 2 + 5}" text-anchor="middle" fill="${COLOR.dim}">claude</text>
${frames}
</svg>
`
}

const at = process.argv.indexOf('--frame')
if (at === -1) {
  writeFileSync(join(root, 'docs', 'demo.svg'), svg())
  console.log('wrote docs/demo.svg')
} else {
  const out = process.argv[at + 2]
  writeFileSync(out, svg(Number(process.argv[at + 1])))
  console.log(`wrote ${out}`)
}
