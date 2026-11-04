import type { CallState, FileChange } from '../types'
import { FILE_TOOLS, SHELL_TOOLS } from './changes'
import { plural } from './draw'

// Which calls a run folds, and how the run's line counts them, in the order the line names them.

const CALL_KINDS: { verb: string; noun: string; is: (tool: string) => boolean }[] = [
  { verb: 'ran', noun: 'shell command', is: tool => SHELL_TOOLS.has(tool) },
  { verb: 'read', noun: 'file', is: tool => tool === 'Read' },
  { verb: 'searched', noun: 'pattern', is: tool => tool === 'Grep' || tool === 'Glob' },
  { verb: 'made', noun: 'web lookup', is: tool => tool === 'WebFetch' || tool === 'WebSearch' },
  { verb: 'launched', noun: 'agent', is: tool => tool === 'Agent' },
  { verb: 'called', noun: 'MCP tool', is: tool => tool.startsWith('mcp__') },
]

// File changes come first, each file once, whichever calls changed it.
const FILE_KINDS: { verb: string; noun: string; kind: FileChange['kind'] }[] = [
  { verb: 'updated', noun: 'file', kind: 'updated' },
  { verb: 'created', noun: 'file', kind: 'created' },
  { verb: 'deleted', noun: 'file', kind: 'deleted' },
  { verb: 'edited', noun: 'notebook', kind: 'notebook' },
]

// The tools a run folds: file edits and every kind above. Anything else (a question, a plan
// prompt, a skill) keeps its row and ends the run.
export function isFoldable(tool: string) {
  return FILE_TOOLS.has(tool) || CALL_KINDS.some(k => k.is(tool))
}

// The run's words (`updated 2 files, ran 3 shell commands`) and its total line counts.
export function summarize(items: { tool: string; state: CallState }[]) {
  const files = new Map<string, { kind: FileChange['kind']; added: number; removed: number }>()
  for (const { state } of items) {
    if (typeof state !== 'object') continue
    for (const c of state.files) {
      const was = files.get(c.path)
      const added = (c.added ?? 0) + (c.kind === 'created' ? (c.lines ?? 0) : 0)
      const removed = (c.removed ?? 0) + (c.kind === 'deleted' ? (c.lines ?? 0) : 0)
      files.set(c.path, {
        kind: was?.kind ?? c.kind,
        added: (was?.added ?? 0) + added,
        removed: (was?.removed ?? 0) + removed,
      })
    }
  }
  const changed = [...files.values()]
  const counted = [
    ...FILE_KINDS.map(k => ({ ...k, n: changed.filter(f => f.kind === k.kind).length })),
    ...CALL_KINDS.map(k => ({ ...k, n: items.filter(item => k.is(item.tool)).length })),
  ]
  const words = counted
    .filter(k => k.n > 0)
    .map(k => `${k.verb} ${plural(k.n, k.noun)}`)
    .join(', ')
  return {
    words: words || 'working',
    hasChanges: changed.some(f => f.kind !== 'notebook'),
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  }
}
