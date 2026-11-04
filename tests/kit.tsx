import type { On, SessionMessage } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

// What every test file builds on: a fake engine beneath the mod, transcript rows, and the
// components a test mounts through the mod.

export const PLUGIN = 'cc-compact-view'
const COMMAND = 'compact-view'
export const ROOT = 'C:\\proj'
// One hunk: +2 −1.
export const PATCH = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]

// A transcript row; `thinking` (test-only) stands for a thinking block shown in the transcript.
export type Row = SessionMessage & { thinking?: string }

// The Messages API form of rows, as `$.session.messages({ as: 'api' })` answers:
// thinking, text, tool_use, tool_result.
function apiForm(rows: Row[]) {
  return rows.map(row => ({
    role: row.role,
    content:
      row.role === 'user'
        ? row.toolResults?.length
          ? row.toolResults.map(r => ({ type: 'tool_result', tool_use_id: r.tool_use_id, content: r.text }))
          : [{ type: 'text', text: row.text }]
        : [
            ...(row.thinking !== undefined ? [{ type: 'thinking', thinking: row.thinking }] : []),
            ...(row.text ? [{ type: 'text', text: row.text }] : []),
            ...row.toolUses.map(c => ({ type: 'tool_use', id: c.tool_use_id, name: c.tool, input: c.input })),
          ],
  }))
}

// Stands in for the engine beneath the mod: the main transcript (`rows`, or a function read
// each time, which may throw), subagents' transcripts by agentId, and the stored values.
// Every row the mod passes on draws `stock row`. Returns the notices shown to the person.
export function engine(
  on: On,
  {
    rows = [],
    agents = {},
    store,
  }: { rows?: Row[] | (() => Row[]); agents?: Record<string, Row[]>; store?: Record<string, unknown> } = {},
) {
  const shown: string[] = []
  mock.store(on, store)
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', (_, e) => {
    const own = e.agentId === undefined ? (typeof rows === 'function' ? rows() : rows) : (agents[e.agentId] ?? [])
    return { value: e.as === 'api' ? apiForm(own) : own } as never
  })
  on('ui.toast', (_, e) => {
    shown.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>stock row</Text>
  })
  return shown
}

// Rows of a transcript.
export const prompt = (text = 'go'): Row => ({ role: 'user', text, toolUses: [] })
export const said = (text: string, toolUses: SessionMessage['toolUses'], thinking?: string): Row => ({
  role: 'assistant',
  text,
  toolUses,
  ...(thinking === undefined ? {} : { thinking }),
})
export const results = (...ids: string[]): Row =>
  ({ role: 'user', text: '', toolUses: [], toolResults: ids.map(id => ({ tool_use_id: id, text: 'ok' })) }) as never

// Finished calls in a transcript.
export const editCall = (id: string, path = `C:/proj/${id}.ts`) => ({
  tool_use_id: id,
  tool: 'Edit',
  input: {},
  result: { filePath: path, structuredPatch: PATCH },
  text: 'ok',
})
export const writeCall = (id: string, path: string) => ({
  tool_use_id: id,
  tool: 'Write',
  input: {},
  result: { type: 'create', filePath: path, content: 'a\nb\nc\n', structuredPatch: [] },
  text: 'ok',
})
export const call = (id: string, tool: string, result: unknown = {}) => ({
  tool_use_id: id,
  tool,
  input: {},
  result,
  text: 'ok',
})
export const failedCall = (id: string, tool: string) => ({
  tool_use_id: id,
  tool,
  input: {},
  text: 'Exit 1',
  isError: true as const,
})
export const runningCall = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })

// Components a test mounts through the mod, on the terminal.
export const toolUse = (id: string, tool = 'Edit', isRunning = false) =>
  ({
    plugin: PLUGIN,
    component: 'ToolUse',
    requestId: id,
    surface: 'terminal',
    props: { tool_use_id: id, tool, input: {}, isRunning, isErrored: false, isInterrupted: false },
  }) as const

export const toolResult = (id: string, tool: string, output: unknown, extra: Record<string, unknown> = {}) =>
  ({
    plugin: PLUGIN,
    component: 'ToolResult',
    requestId: id,
    surface: 'terminal',
    props: { tool_use_id: id, tool, output, isErrored: false, ...extra },
  }) as never

// An engine group line over [id, tool, isRunning?, isErrored?] calls.
export const toolGroup = (calls: [string, string, boolean?, boolean?][], isExpanded = false) =>
  ({
    plugin: PLUGIN,
    component: 'ToolGroup',
    requestId: `g-${calls[0]![0]}`,
    surface: 'terminal',
    props: {
      calls: calls.map(([id, tool, isRunning, isErrored]) => ({
        tool_use_id: id,
        tool,
        input: {},
        isRunning: Boolean(isRunning),
        isErrored: Boolean(isErrored),
        isInterrupted: false,
      })),
      isActive: false,
      isExpanded,
    },
  }) as never

type Test$ = Parameters<TestBody>[0]

// Starts a session, so the mod registers /compact-view.
export async function startSession($: Test$, on: On) {
  on('command.register', () => ({ value: { command: COMMAND } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

// What `/compact-view <args>` answers, as text.
export async function runCommand($: Test$, args: string) {
  return JSON.stringify(await $.command.run({ command: COMMAND, args } as Parameters<Test$['command']['run']>[0]))
}

// Whether the mounted component draws as the engine would, the mod passing it on.
export async function isStock($: Test$, component: unknown) {
  const ui = await $.ui.mount(component as never)
  const text = (await ui.find({ type: 'Text', text: /stock/ }))?.text
  await ui.unmount()
  return text === 'stock row'
}

// Whether the mounted component draws nothing at all (a row folded into a closed run).
export async function isBlank($: Test$, component: unknown) {
  const ui = await $.ui.mount(component as never)
  const text = await ui.find({ type: 'Text' })
  await ui.unmount()
  return text === undefined
}

// The run line's text, where the mounted component draws one.
export async function runLineOf($: Test$, component: unknown) {
  const ui = await $.ui.mount(component as never)
  const text = (await ui.find({ type: 'Button' }))?.text
  await ui.unmount()
  return text
}
