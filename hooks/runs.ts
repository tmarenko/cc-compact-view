import type { EngineInterface, ToolUseSummary } from 'claude-code'
import { atom, memberOf, read, update } from 'claude-code'

import type { CallState } from '../types'
import { bashChangedFiles, bashDiffOf, FILE_TOOLS, fileChange, fileOfInput, SHELL_TOOLS } from './changes'
import { isFoldable } from './kinds'
import type { Flat } from './transcript'
import { transcript } from './transcript'

// Which run of calls a call belongs to. A run: finished foldable calls in one conversation
// with nothing drawn between them. Only a run of two or more folds.

// By tool_use_id: each foldable call's outcome as this session saw it made, and the subagent
// that made it (render events don't say). One open state per run, under its first call's id.
// The plugin validator reads and writes state only in the file that defines it: this one.
const calls = atom({ plugin: 'cc-compact-view', key: 'calls' } as const, {}, { shape: 'calls-3' })
const owners = atom({ plugin: 'cc-compact-view', key: 'owners' } as const, {}, { shape: 'owners-1' })
const isOpen = atom({ plugin: 'cc-compact-view', key: 'isOpen' } as const, false)

// How many calls the by-id records keep: far more than a screen of rows. A call past it is
// read from the transcript instead, the same way for every row of its run.
const REMEMBERED = 500

// The record with `id` set, the oldest entries dropped past REMEMBERED.
function remember<T>(known: Record<string, T>, id: string, value: T) {
  return { ...Object.fromEntries(Object.entries(known).slice(-REMEMBERED)), [id]: value }
}

export function recordCall($: EngineInterface, id: string, state: CallState) {
  return update($, calls, known => remember(known, id, state))
}

export function recordOwner($: EngineInterface, id: string, agentId: string) {
  return update($, owners, known => remember(known, id, agentId))
}

export function toggleRun($: EngineInterface, firstId: string) {
  return update($, memberOf(isOpen, { requestId: firstId }), was => !was)
}

// Calls of engine groups this mod lets draw the usual way: they never join a run, so a
// run's line can't sit inside such a group while its other rows hide.
export const stockGrouped = new Set<string>()

export type RunState = { run: string[]; flat: Flat; known: Record<string, CallState>; isOpenNow: boolean }

// What a finished call left: the files it changed, or stock for one drawn as usual.
export function outcomeOf(tool: string, result: unknown): CallState {
  if (FILE_TOOLS.has(tool)) {
    const change = fileChange(tool, result)
    return change ? { files: [change] } : 'stock'
  }
  if (SHELL_TOOLS.has(tool)) return { files: bashChangedFiles(bashDiffOf(result)) }
  return { files: [] }
}

// As recorded when the call was made, else as the transcript says (a call made before the mod
// loaded, or past REMEMBERED). A subagent's transcript keeps no results: an edit there counts its file only.
export function stateOf(call: ToolUseSummary, known: Record<string, CallState>): CallState {
  const seen = known[call.tool_use_id]
  if (seen) return seen
  if (call.result === undefined && call.text === undefined) return 'running'
  if (call.isError) return { files: [], isFailed: true }
  if (call.result === undefined && FILE_TOOLS.has(call.tool)) {
    const file = fileOfInput(call.tool, call.input)
    return { files: file ? [file] : [] }
  }
  return outcomeOf(call.tool, call.result)
}

// The ids of the run holding `id`, in order; undefined when `id` folds into none.
// Only finished calls fold: a running one keeps its row (the command, ctrl+b) until it ends.
// Calls in `own` are judged as if no engine group had kept them out (that group deciding afresh).
function runOf(flat: Flat, id: string, known: Record<string, CallState>, own: ReadonlySet<string>) {
  let run: string[] = []
  for (const { call, isAfterBreak } of flat.list) {
    const isKeptOut = stockGrouped.has(call.tool_use_id) && !own.has(call.tool_use_id)
    const folds = isFoldable(call.tool) && typeof stateOf(call, known) === 'object' && !isKeptOut
    if (isAfterBreak || !folds) {
      if (run.includes(id)) return run
      run = []
    }
    if (folds) run.push(call.tool_use_id)
  }
  return run.includes(id) ? run : undefined
}

const agentsOf = (flat: Flat) => flat.list.flatMap(({ call }) => (call.agentId ? [call.agentId] : []))

// The subagent that made `id`, or undefined for the main conversation. As recorded when the call
// was made, else found through the transcripts: each Agent call names the agent it spawned, so the
// subagents (and theirs) are searched level by level. Not found anywhere: the main conversation,
// where the row draws as usual.
async function ownerOf($: EngineInterface, id: string): Promise<string | undefined> {
  const recorded = (await read($, owners))[id]
  if (recorded !== undefined) return recorded
  const main = await transcript($, undefined, id)
  if (main.ids.has(id)) return undefined
  const seen = new Set<string>()
  let level = agentsOf(main)
  while (level.length > 0) {
    const fresh = level.filter(agentId => !seen.has(agentId))
    for (const agentId of fresh) seen.add(agentId)
    const flats = await Promise.all(fresh.map(agentId => transcript($, agentId)))
    const at = flats.findIndex(flat => flat.ids.has(id))
    if (at !== -1) return fresh[at]
    level = flats.flatMap(agentsOf)
  }
  return undefined
}

// The run of two or more holding `id` and whether a click opened it; undefined when it folds into none.
// Errors are not swallowed here: a row that drew the stock way while the rest of its run
// stayed hidden would lose those rows, so a failure trips the whole mod off instead.
export async function foldState(
  $: EngineInterface,
  id: string,
  own: ReadonlySet<string> = new Set(),
): Promise<RunState | undefined> {
  const known = await read($, calls)
  const agentId = await ownerOf($, id)
  const flat = await transcript($, agentId, id)
  const run = runOf(flat, id, known, own)
  if (!run || run.length < 2) return undefined
  // The run's first row draws its line from where it finds itself: should it look elsewhere
  // (its owner unknown, and no transcript names the subagent), it would draw as usual, so no
  // row of the run may hide.
  if (run[0] !== id && (await ownerOf($, run[0]!)) !== agentId) return undefined
  return { run, flat, known, isOpenNow: await read($, memberOf(isOpen, { requestId: run[0]! })) }
}

// Whether a call's result line sits in a closed run, and so draws nothing: the run's line says it all.
export async function isHidden($: EngineInterface, id: string) {
  const state = await foldState($, id)
  return Boolean(state && !state.isOpenNow)
}
