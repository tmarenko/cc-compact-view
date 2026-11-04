import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { CallState } from '../types'
import { clickableLine, TEXT_INDENT } from './draw'
import { isFoldable, summarize } from './kinds'
import type { RunState } from './runs'
import { foldState, outcomeOf, recordCall, recordOwner, stateOf, stockGrouped, toggleRun } from './runs'
import { fallBack, isFolding, redrawAll } from './switch'
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
  const toggle = () => void toggleRun($, run[0]!).catch(() => undefined)
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
  if (!(await isFolding($, e))) return undefined
  const state = await foldState($, id)
  if (!state?.isOpenNow || state.run.at(-1) !== id) return undefined
  return runLine($, e, state, true)
}

export const registerFold: Register = on => {
  // Records each foldable call the model makes: its outcome as it finishes, and which subagent
  // made it (rows don't say); and has the transcript read again so the run's first row sees it.
  // Calls a plugin makes through $.tool.call have no row and are left alone.
  on('tool.call', async ($, e, next) => {
    if (!isFoldable(e.tool) || next.origin.plugin !== 'engine') return next(e)
    const { tool_use_id: id, agentId } = e
    // Drawing only: a failed write must never fail the call itself.
    const set = (state: CallState) => {
      readAgain()
      return recordCall($, id, state).catch(() => undefined)
    }
    if (agentId !== undefined) await recordOwner($, id, agentId).catch(() => undefined)
    await set('running')
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (err) {
      // Interrupted (Esc) or failed beneath: the call is over either way, so it folds as failed.
      await set({ files: [], isFailed: true })
      throw err
    }
    const isFailed = 'deny' in ran || ran.isError === true
    await set(
      isFailed ? { files: [], isFailed: true } : ran.result !== undefined ? outcomeOf(e.tool, ran.result) : 'stock',
    )
    return ran
  }).catch(($, e, next) => {
    // An interrupted call is no fault of the mod's: pass it on without turning the mod off.
    if (next.signal.aborted) return next(e)
    return fallBack($, 'recording a tool call', e, next)
  })

  // A new turn, main or a subagent's, may follow a rewind or a /clear: read the transcripts afresh.
  on('turn.start', async (_$, e, next) => {
    readAgain()
    return next(e)
  }).catch(($, e, next) => fallBack($, 'starting a turn', e, next))

  // A compaction rewrites the transcript: read it afresh and redraw.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    readAgain()
    redrawAll($)
    return compacted
  }).catch(($, e, next) => fallBack($, 'after a compaction', e, next))

  // A standalone row. Closed: the run's first draws the run's line, the others nothing
  // (not even their blank line). Open: the line, then every row as usual.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool_use_id: id, tool, isExpanded } = e.props
    if (!isFoldable(tool) || isExpanded || !(await isFolding($, e))) return next(e)
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

  // The engine's own group line (`Ran 2 shell commands`), when the whole group sits in one run.
  // As a standalone row's, its blank line is inside its drawing. Any other group draws the usual
  // way and its calls leave every run: one with a call running, one holding a call or a row that
  // doesn't fold (recalled memory, hook timing), one the transcript splits differently from the
  // engine, and one expanded while its run is closed (--verbose, or a click on its rows left
  // it expanded), whose rows all show.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls: grouped, isExpanded, isCallsOnly } = e.props
    if (grouped.length === 0 || !(await isFolding($, e))) return next(e)
    const ids = grouped.flatMap(c => (typeof c.tool_use_id === 'string' ? [c.tool_use_id] : []))
    const own = new Set(ids)
    const wasStock = ids.filter(id => stockGrouped.has(id)).length
    // A live group draws as usual and keeps nothing out: running calls don't fold anyway, and the
    // engine may move a finished call out of it (a command that changed files gets a row of its
    // own), never drawing this group again to undo an exclusion.
    if (grouped.some(c => c.isRunning)) {
      for (const id of ids) stockGrouped.delete(id)
      if (wasStock > 0) redrawAll($)
      return next(e)
    }
    // isCallsOnly is also false for an errored or interrupted call, which folds as failed.
    const hasOtherRows = isCallsOnly === false && !grouped.some(c => c.isErrored || c.isInterrupted)
    const isCandidate = ids.length === grouped.length && !hasOtherRows && grouped.every(c => isFoldable(c.tool))
    // Decided as if this group had kept nothing out, while other rows still read the set as it was.
    const state = isCandidate ? await foldState($, ids[0]!, own) : undefined
    const folds = state !== undefined && ids.every(id => state.run.includes(id)) && (state.isOpenNow || !isExpanded)
    // One step, after the wait: a row that drew meanwhile read a set that holds, or is redrawn.
    for (const id of ids) {
      if (folds) stockGrouped.delete(id)
      else stockGrouped.add(id)
    }
    if (folds ? wasStock > 0 : wasStock !== ids.length) redrawAll($)
    if (!folds) return next(e)

    const { Box } = $.ui.resolve(e)
    const isHead = state.run[0] === ids[0]
    if (!state.isOpenNow) return isHead ? runLine($, e, state) : <Box />
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
