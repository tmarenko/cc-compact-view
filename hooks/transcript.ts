import type { EngineInterface, SessionMessage, ToolUseSummary } from 'claude-code'

// A conversation's calls in order, read from the session and kept until the next call is made.

export type Flat = { list: { call: ToolUseSummary; isAfterBreak: boolean }[]; ids: Set<string> }

type Block = { type: string; [field: string]: unknown }
type ApiMessage = { role: string; content: Block[] }

const EMPTY: Flat = { list: [], ids: new Set() }

// Moves on each foldable call this session makes: the transcript is read again after one.
let tick = 0
// One read per conversation: the main one under '', a subagent's under its agentId.
const caches = new Map<string, { tick: number; flat: Promise<Flat>; missed: Set<string> }>()

export function readAgain() {
  tick++
}

const hasWords = (value: unknown) => typeof value === 'string' && value.trim() !== ''

// The calls in order, each marked when something drawn sits above it: a prompt, Claude's text,
// or a thinking update shown in the transcript. Read from the Messages API form, the one that
// keeps thinking blocks; each call's record (its result) comes from the session's rows.
function flatten(api: ApiMessage[], rows: SessionMessage[]): Flat {
  const summaries = new Map(rows.flatMap(row => row.toolUses).map(call => [call.tool_use_id, call]))
  const list: Flat['list'] = []
  let isBreak = true
  for (const message of api) {
    const blocks = Array.isArray(message.content) ? message.content : []
    if (message.role === 'user') {
      if (!blocks.some(b => b.type === 'tool_result') && blocks.some(b => b.type === 'text' && hasWords(b.text))) {
        isBreak = true
      }
      continue
    }
    for (const block of blocks) {
      if ((block.type === 'text' && hasWords(block.text)) || (block.type === 'thinking' && hasWords(block.thinking))) {
        isBreak = true
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const call = summaries.get(block.id) ?? {
          tool_use_id: block.id,
          tool: String(block.name),
          input: (block.input ?? {}) as Record<string, unknown>,
        }
        list.push({ call, isAfterBreak: isBreak })
        isBreak = false
      }
    }
  }
  return { list, ids: new Set(list.map(one => one.call.tool_use_id)) }
}

// The calls of the conversation holding `id`: the main one, or the subagent's that made it.
// One read per tick, shared by every row drawing; read once more for a row it lacks.
// A subagent the session can no longer read (finished, nothing saved) reads as empty: its rows stay stock.
export async function transcript($: EngineInterface, id: string, agentId?: string) {
  const key = agentId ?? ''
  const cache = caches.get(key)
  if (cache?.tick === tick) {
    const flat = await cache.flat
    if (flat.ids.has(id) || cache.missed.has(id)) return flat
    cache.missed.add(id)
  }
  const missed = cache?.tick === tick ? cache.missed : new Set<string>()
  const scope = agentId === undefined ? {} : { agentId }
  // A failed read is not kept: the next row asks again.
  const flat: Promise<Flat> = Promise.all([$.session.messages({ as: 'api', ...scope }), $.session.messages(scope)])
    .then(([api, rows]) => (Array.isArray(api) && Array.isArray(rows) ? flatten(api as ApiMessage[], rows) : EMPTY))
    .catch(err => {
      if (caches.get(key)?.flat === flat) caches.delete(key)
      throw err
    })
  caches.set(key, { tick, flat, missed })
  return flat
}
