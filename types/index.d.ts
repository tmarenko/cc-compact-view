// One file a call changed: an Edit's, a Write's, a notebook's, or one of a shell command's.
export type FileChange = {
  kind: 'created' | 'updated' | 'deleted' | 'notebook'
  verb: string
  path: string
  added?: number
  removed?: number
  lines?: number
}
// A finished call's outcome: the files it changed (none for a read or a search) and whether
// it failed; still running; or drawn the stock way (an edit held for review, nothing to summarize).
export type CallState = { files: FileChange[]; isFailed?: true } | 'running' | 'stock'

declare module 'claude-code' {
  interface PluginState {
    'cc-compact-view': {
      // By tool_use_id, the foldable calls this session has seen made.
      calls: Shaped<Record<string, CallState>>
      // By tool_use_id, the subagent that made a call (render events don't say).
      owners: Shaped<Record<string, string>>
      // One per folded run, by its first row's requestId.
      isOpen: StateFamily<boolean>
      // One per one-line result, by its tool_use_id: whether a click showed the full diff.
      isDiffOpen: StateFamily<boolean>
    }
  }
}
