import type { EngineInterface, SessionMessage, ToolUseSummary } from 'claude-code'

// A conversation's calls in order, read from the session and kept until something changes it:
// a call made, a new turn, a compaction.

export type Flat = { list: { call: ToolUseSummary; isAfterBreak: boolean }[]; ids: Set<string> }

type Block = { type: string; [field: string]: unknown }
type ApiMessage = { role: string; content: Block[] }

const EMPTY: Flat = { list: [], ids: new Set() }

// Moves whenever the transcript may have changed: every read made before it is stale.
let tick = 0
// One read per conversation and tick: the main one under '', a subagent's under its agentId.
// `isReread` once it was read again for a row it lacked, which happens at most once a tick.
const caches = new Map<string, { tick: number; flat: Promise<Flat>; isReread: boolean }>()

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

function startRead($: EngineInterface, key: string, agentId: string | undefined, isReread: boolean) {
  const scope = agentId === undefined ? {} : { agentId }
  // A failed read is not kept: the next row asks again.
  const flat: Promise<Flat> = Promise.all([$.session.messages({ as: 'api', ...scope }), $.session.messages(scope)])
    .then(([api, rows]) => (Array.isArray(api) && Array.isArray(rows) ? flatten(api as ApiMessage[], rows) : EMPTY))
    .catch(err => {
      if (caches.get(key)?.flat === flat) caches.delete(key)
      throw err
    })
  caches.set(key, { tick, flat, isReread })
  return flat
}

// The calls of one conversation: the main one, or a subagent's. Read once a tick, shared by every
// row drawing. Given `id`, a read that lacks it is made once more (the call may have been written
// after the read began); a row it still lacks belongs elsewhere.
// A subagent the session can no longer read (finished, nothing saved) reads as empty: its rows stay stock.
export async function transcript($: EngineInterface, agentId?: string, id?: string) {
  const key = agentId ?? ''
  const cache = caches.get(key)
  if (cache?.tick !== tick) return startRead($, key, agentId, false)
  const flat = await cache.flat
  if (id === undefined || flat.ids.has(id) || cache.isReread) return flat
  // Another row may have started the read again meanwhile: share it.
  const now = caches.get(key)
  if (now && now !== cache) return now.flat
  return startRead($, key, agentId, true)
}
