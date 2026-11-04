# Changelog

## 1.0.0 (2026-11-04)

First release.

- Runs of back-to-back tool calls (edits, file writes, shell commands, reads,
  searches, web lookups, subagent launches, MCP calls) fold into one clickable
  line that counts each kind and the lines added and removed; an open run ends
  with a `Collapse:` line. Subagent views fold too.
- Edit, Write, NotebookEdit and file-changing shell commands show a one-line
  `path +N −M` summary instead of the diff; click it for the full diff.
- Running commands, questions, plan prompts and Claude's text stay visible.
- Any failure turns the mod off for the session with a notice, and the normal
  view comes back. `/compact-view [on|off]` toggles it.
