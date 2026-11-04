import type { FileChange } from '../types'

// What a call changed, read from the tool's own result: the file, the kind of change, the counts.

type Hunk = { lines?: unknown }
type FileOutput = {
  filePath?: string
  type?: 'create' | 'update'
  content?: string
  structuredPatch?: Hunk[]
  gitDiff?: { additions?: number; deletions?: number }
  staged?: boolean
}
type NotebookOutput = { notebook_path?: string; cell_id?: string; edit_mode?: string }
type BashFile = { filePath?: string; hunks?: Hunk[]; created?: true; deleted?: true }
export type BashEditDiff = { files?: BashFile[]; moreFiles?: number }

export const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

function count(hunks: Hunk[] | undefined) {
  let added = 0
  let removed = 0
  for (const hunk of Array.isArray(hunks) ? hunks : []) {
    if (!Array.isArray(hunk?.lines)) continue
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line[0] === '+') added++
      else if (line[0] === '-') removed++
    }
  }
  return { added, removed }
}

function lineCount(text: unknown) {
  if (typeof text !== 'string' || text === '') return 0
  return text.replace(/\n$/, '').split('\n').length
}

// The path as the project sees it; unchanged outside the project.
export function relative(path: string, root: string | undefined) {
  if (!root) return path
  const fold = (s: string) => s.replace(/\\/g, '/')
  const base = `${fold(root).replace(/\/$/, '')}/`
  const p = fold(path)
  const isWindows = /^[a-z]:\//i.test(base)
  const inside = isWindows ? p.toLowerCase().startsWith(base.toLowerCase()) : p.startsWith(base)
  return inside ? path.slice(base.length) : path
}

// Undefined for anything drawn the stock way: a review-held edit, a missing path. Paths stay absolute.
export function fileChange(tool: string, out: unknown): FileChange | undefined {
  if (!out || typeof out !== 'object') return undefined
  if (tool === 'NotebookEdit') {
    const nb = out as NotebookOutput
    if (typeof nb.notebook_path !== 'string') return undefined
    const cell = nb.cell_id ? ` cell ${nb.cell_id}` : ''
    const verb = { replace: 'Replaced', insert: 'Inserted', delete: 'Deleted' }[nb.edit_mode ?? ''] ?? 'Edited'
    return { kind: 'notebook', verb: `${verb}${cell}`, path: nb.notebook_path }
  }
  const f = out as FileOutput
  if (f.staged || typeof f.filePath !== 'string') return undefined
  const path = f.filePath
  if (tool === 'Write' && f.type === 'create')
    return { kind: 'created', verb: 'Created', path, lines: lineCount(f.content) }
  // An empty patch means the diff timed out or the file was too large: git's counts stand in.
  if (!f.structuredPatch?.length && f.gitDiff) {
    return {
      kind: 'updated',
      verb: 'Updated',
      path,
      added: f.gitDiff.additions ?? 0,
      removed: f.gitDiff.deletions ?? 0,
    }
  }
  return { kind: 'updated', verb: 'Updated', path, ...count(f.structuredPatch) }
}

// The diff the engine keeps on a shell command's result for drawing (an internal field).
export const bashDiffOf = (output: unknown) => (output as { bashEditDiff?: BashEditDiff } | undefined)?.bashEditDiff

// The files a shell command changed (missing or empty diff: none). Paths stay absolute.
export function bashChanges(diff: BashEditDiff | undefined): FileChange[] {
  const files = Array.isArray(diff?.files) ? diff.files.filter(f => typeof f?.filePath === 'string') : []
  return files.map(f => {
    const path = f.filePath as string
    const { added, removed } = count(f.hunks)
    if (f.created) return { kind: 'created', verb: 'Created', path, lines: added }
    if (f.deleted) return { kind: 'deleted', verb: 'Deleted', path, lines: removed }
    return { kind: 'updated', verb: 'Updated', path, added, removed }
  })
}
