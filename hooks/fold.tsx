import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { CallState } from '../types'
import { clickableLine, TEXT_INDENT } from './draw'
import { isFoldable, summarize } from './kinds'
import type { RunState } from './runs'
import { foldState, outcomeOf, recordCall, recordOwner, stateOf, stockGrouped, toggleRun } from './runs'
import { fallBack, isActive, isFolding, redrawAll } from './switch'
import { readAgain } from './transcript'

// Folds a run of finished tool calls (consecutive, nothing drawn between them) into one
// row: `Updated 2 files, ran 3 shell commands, read 1 file  +52 −7`. A click opens the
// run into its usual rows under that line, and closes it again. A failed call folds too and
// counts as its tool's kind, as the engine's own group line folds one. A running call (a
// foreground subagent included), a call inside an engine group drawn the usual way, and any
// tool not folded here (a question, a plan prompt, a skill) draws as usual and ends the run.

// The run's one line: headline and totals; a click opens or closes the run.
// At the end of an open run (`isEnd`) the same line, led by "Collapse:", closes it from below.
function drawRun($: EngineInterface, e: ResolveInput, { run, flat, known }: RunState, isEnd = false) {
  const byId = new Map(flat.list.map(one => [one.call.tool_use_id, one.call]))
  const items = run.flatMap(id => {
    const call = byId.get(id)
    return call ? [{ tool: call.tool, state: stateOf(call, known) }] : []
  })
  const { words, hasChanges, added, removed } = summarize(items)
  const elements = $.ui.resolve(e)
  const { Text } = elements
  const content = [
    isEnd ? `Collapse: ${words}` : words[0]!.toUpperCase() + words.slice(1),
    hasChanges && <Text color="success">{`  +${added}`}</Text>,
    hasChanges && <Text color="error">{` −${removed}`}</Text>,
  ]
  const toggle = () => void toggleRun($, run[0]!)
  // No bullet: indented to the other rows' text.
  const keys = isEnd ? { box: 'run-end', button: 'fold-end' } : { box: 'run', button: 'fold' }
  return clickableLine(elements, keys, toggle, content, TEXT_INDENT)
}

// The run's line in place of a row: the row's blank line above it is part of the row's own
// drawing, so the run's line puts one back.
function runLine($: EngineInterface, e: ResolveInput, state: RunState, isEnd = false) {
  const { Box } = $.ui.resolve(e)
  return <Box marginTop={1}>{drawRun($, e, state, isEnd)}</Box>
}

// The closing line under an open run's last call: undefined for any other result.
// A standalone row's result draws it; inside an engine group the group's drawing does.
export async function collapseLine($: EngineInterface, e: ResolveInput, id: string) {
  if (e.surface !== 'terminal' || !isActive()) return undefined
  const state = await foldState($, id)
  if (!state?.isOpenNow || state.run.at(-1) !== id) return undefined
  return runLine($, e, state, true)
}

export const registerFold: Register = on => {
  // Records each foldable call's outcome as it finishes, and which subagent made it (rows
  // don't say), and has the transcript read again so the run's first row sees the call.
  on('tool.call', async ($, e, next) => {
    if (!isFoldable(e.tool)) return next(e)
    const { tool_use_id: id, agentId } = e
    // Drawing only: a failed write must never fail the call itself.
    const set = (state: CallState) => {
      readAgain()
      return recordCall($, id, state).catch(() => undefined)
    }
    if (agentId !== undefined) await recordOwner($, id, agentId).catch(() => undefined)
    await set('running')
    const ran = await next(e)
    const isFailed = 'deny' in ran || ran.isError === true
    await set(
      isFailed ? { files: [], isFailed: true } : ran.result !== undefined ? outcomeOf(e.tool, ran.result) : 'stock',
    )
    return ran
  }).catch(($, e, next) => fallBack($, 'recording a tool call', e, next))

  // A standalone row. Closed: the run's first draws the run's line, the others nothing
  // (not even their blank line). Open: the line, then every row as usual.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool_use_id: id, tool, isExpanded } = e.props
    if (!isFoldable(tool) || isExpanded || !(await isFolding($, e.surface))) return next(e)
    const state = await foldState($, id)
    if (!state) return next(e)
    const { Box } = $.ui.resolve(e)
    const isHead = state.run[0] === id
    if (!state.isOpenNow) return isHead ? runLine($, e, state) : <Box />
    if (!isHead) return next(e)
    return (
      <Box flexDirection="column" marginTop={1}>
        {drawRun($, e, state)}
        {await next(e)}
      </Box>
    )
  }).catch(($, e, next) => fallBack($, 'drawing a tool row', e, next))

  // The engine's own group line (`Ran 2 shell commands`), when the whole group sits in
  // one run. As a standalone row's, its blank line is inside its drawing.
  // Any other group (a call running or not foldable, or one the transcript splits
  // differently from the engine) draws the usual way, and its calls leave every run.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls: grouped, isExpanded } = e.props
    if (grouped.length === 0 || !(await isFolding($, e.surface))) return next(e)
    const ids = grouped.flatMap(c => (typeof c.tool_use_id === 'string' ? [c.tool_use_id] : []))
    // Decided afresh on each drawing, this group's own earlier answer left out.
    const wasStock = ids.filter(id => stockGrouped.has(id)).length
    for (const id of ids) stockGrouped.delete(id)
    // A live group (a call still running) draws as usual and excludes nothing: running calls
    // don't fold anyway, and the engine may move a finished call out of it (a command that
    // changed files gets a row of its own), never drawing this group again to undo an exclusion.
    if (grouped.some(c => c.isRunning)) {
      if (wasStock > 0) redrawAll($)
      return next(e)
    }
    const isCandidate = ids.length === grouped.length && grouped.every(c => isFoldable(c.tool))
    const state = isCandidate ? await foldState($, ids[0]!) : undefined
    if (!state || !ids.every(id => state.run.includes(id))) {
      for (const id of ids) stockGrouped.add(id)
      // Newly stock: rows of a run that ran through this group draw again without it.
      if (wasStock !== ids.length) redrawAll($)
      return next(e)
    }
    if (wasStock > 0) redrawAll($)
    const { Box } = $.ui.resolve(e)
    const isHead = state.run[0] === ids[0]
    if (!state.isOpenNow) {
      // Closed, but expanded by the ctrl+o transcript or --verbose: drawn in full.
      if (isExpanded) return next(e)
      return isHead ? runLine($, e, state) : <Box />
    }
    // Open: the group unfolded into its own rows. A click on those rows flips the
    // engine's own isExpanded; the run's state wins, so the group stays open under its line.
    const rows = await next({ ...e, props: { ...e.props, isExpanded: true } })
    const end = ids.includes(state.run.at(-1)!) && runLine($, e, state, true)
    if (!isHead && !end) return rows
    return (
      <Box flexDirection="column" marginTop={isHead ? 1 : 0}>
        {isHead && drawRun($, e, state)}
        {rows}
        {end}
      </Box>
    )
  }).catch(($, e, next) => fallBack($, 'drawing a tool group', e, next))
}
