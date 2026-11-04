# Changelog

## 1.1.0 (2026-11-04)

- Runs fold only in the fullscreen terminal, Claude Code's default layout; on
  the main screen (and outside the terminal) only the one-line edit results
  apply. Rows there can't be clicked, and a row already printed to scrollback
  can't be redrawn, so a run could lose rows.
- Fixed rows that could disappear: a row drawn while a group line decided
  again, a subagent's run in a long session, and a closed run whose group a
  click had left expanded.
- Subagent runs fold even when the mod didn't see their calls made: each Agent
  call names the subagent it started.
- Esc during a call no longer turns the mod off.
- A group holding recalled memory or hook timing draws as usual instead of
  hiding those rows. ctrl+o shows no `Collapse:` line.
- Counts: a Write that changed nothing shows `+0 −0`; a command counts every
  file it changed; one file counts once however its path is written; a failed
  notebook edit draws as usual.
- LSP lookups, tool searches and MCP resource reads fold with the rest.
- The transcript is read at most once more per refresh for rows it lacks, and
  read afresh on each new turn and after `/compact`.
- `/compact-view off` restores every row at once.

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
