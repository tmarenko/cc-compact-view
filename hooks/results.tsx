import type { Register } from 'claude-code'
import { atom, memberOf, read, update } from 'claude-code'

import { bashChanges, bashDiffOf, FILE_TOOLS, fileChange, relative, SHELL_TOOLS } from './changes'
import type { Line } from './draw'
import { clickableLine, drawLine, GUTTER, plural } from './draw'
import { collapseLine } from './fold'
import { isFoldable } from './kinds'
import { isHidden } from './runs'
import { fallBack, isActive, isEnabled, isFolding, load } from './switch'

// Draws one summary line in place of the diff under file-editing tool results; a click shows
// the full diff under it. Render-only: the stored result and what the model sees are untouched.

// Whether a click on a one-line result showed its full diff under it.
const isDiffOpen = atom({ plugin: 'cc-compact-view', key: 'isDiffOpen' } as const, false)

// What each row showed when first drawn, so a switch changes only rows drawn after it.
const muted = new Map<string, boolean>()

async function isMutedRow($: Parameters<typeof load>[0], id: string) {
  let isMuted = muted.get(id)
  if (isMuted === undefined) {
    await load($)
    isMuted = isEnabled()
    muted.set(id, isMuted)
  }
  return isMuted && isActive()
}

export const registerResults: Register = on => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool_use_id: id, tool, output, isErrored, isExpanded } = e.props
    // Under the last call of an open run, the line that closes it from below.
    const end = isFoldable(tool) ? await collapseLine($, e, id) : undefined
    const drawn = await drawResult()
    if (!end) return drawn
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {end}
      </Box>
    )

    async function drawResult() {
      // The ctrl+o transcript keeps the stock drawing.
      if (isExpanded) return next(e)
      // A call folded into a closed run draws no result line, a failed one's error included.
      if (isFoldable(tool) && (await isFolding($, e.surface)) && (await isHidden($, id))) {
        const { Box } = $.ui.resolve(e)
        return <Box />
      }
      // Errors and other tools keep the stock drawing.
      if (isErrored || !output || typeof output !== 'object') return next(e)
      const isShell = SHELL_TOOLS.has(tool)
      if (!isShell && !FILE_TOOLS.has(tool)) return next(e)
      const bashDiff = isShell ? bashDiffOf(output) : undefined
      if (isShell && !bashDiff?.files?.length && !bashDiff?.moreFiles) return next(e)
      if (!(await isMutedRow($, id))) return next(e)

      const root = await $.session.root().catch(() => undefined)
      const elements = $.ui.resolve(e)
      const { Box } = elements
      const lead = e.surface === 'terminal' ? GUTTER : ''
      const isOpenNow = await read($, memberOf(isDiffOpen, e))
      const toggle = () => void update($, memberOf(isDiffOpen, e), was => !was)
      const line = (s: Line, key: string) =>
        clickableLine(elements, { box: `line-${key}`, button: `diff-${key}` }, toggle, drawLine(elements, lead, s))

      if (!isShell) {
        const change = fileChange(tool, output)
        if (!change) return next(e)
        const summary = line({ ...change, path: relative(change.path, root) }, 'file')
        if (!isOpenNow) return summary
        return (
          <Box flexDirection="column">
            {summary}
            {await next(e)}
          </Box>
        )
      }
      // A shell command: its own output drawn as usual, minus the diff, then one line per file;
      // opened, the stock drawing with the diff.
      const { bashEditDiff: _, ...rest } = output as Record<string, unknown>
      const stock = await next(isOpenNow ? e : { ...e, props: { ...e.props, output: rest } })
      const lines: Line[] = bashChanges(bashDiff).map(c => ({ ...c, path: relative(c.path, root) }))
      const more = Number.isInteger(bashDiff?.moreFiles) ? (bashDiff?.moreFiles as number) : 0
      if (more > 0) lines.push({ verb: `… ${plural(more, 'more file')}` })
      return (
        <Box flexDirection="column">
          {stock}
          {lines.map((s, i) => line(s, String(i)))}
        </Box>
      )
    }
  }).catch(($, e, next) => fallBack($, 'drawing a tool result', e, next))
}
