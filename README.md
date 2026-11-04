# cc-compact-view

[![CI](https://github.com/tmarenko/cc-compact-view/actions/workflows/ci.yml/badge.svg)](https://github.com/tmarenko/cc-compact-view/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tmarenko/cc-compact-view)](https://github.com/tmarenko/cc-compact-view/releases)
[![License: MIT](https://img.shields.io/github/license/tmarenko/cc-compact-view)](LICENSE)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-D97757)](https://github.com/tmarenko/cc-compact-view#install)

A Claude Code mod for a leaner transcript. It changes only what the terminal
draws: what Claude sees, the stored conversation and the tools themselves are
untouched.

![A Claude Code turn: each tool call folds into one summary line as it finishes](docs/demo.svg)

- **Runs of tool calls fold into one line.** Back-to-back tool calls (edits,
  file writes, shell commands, reads, searches, web lookups, subagent launches,
  MCP calls) collapse into one dim line that counts each kind and the total
  lines added and removed:

  ```
  Updated 2 files, created 1 file, ran 3 shell commands, read 1 file  +52 −7
  ```

  Click it to open the run into the usual rows; a `Collapse: ...` line under
  the last call closes it again without scrolling back up. Subagent views fold
  the same way.
- **Edit diffs shrink to one line.** Under Edit, Write, NotebookEdit and a
  shell command that changed files, the diff becomes
  `⎿  Updated src/a.ts  +12 −3`. Click it for the full diff.
- **What you still need stays visible.** A command that is still running keeps
  its row (and its ctrl+b hint), and so do questions to you, plan prompts and
  Claude's text. ctrl+o shows everything the normal way.
- **A failure falls back to the normal view.** If anything in the mod fails,
  it turns itself off for the session, says so once, and the normal Claude
  Code view comes back.

How it compares with mods that hide diffs: those keep one row per tool call;
this one also folds the calls themselves, so a turn of twenty calls takes one
line until you open it.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cc-compact-view --marketplace tmarenko/cc-compact-view
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one).
From a shell:

```
claude plugin install cc-compact-view --marketplace tmarenko/cc-compact-view
```

Built and tested on Claude Code 2.1.311. The mod API is early access and may
change between releases, so CI also runs the tests against the newest Claude
Code every week.

## Use

| Command | What it does |
| --- | --- |
| `/compact-view` | toggles the mod; after an error, prints the error instead |
| `/compact-view on` / `off` | sets it; the choice is kept across sessions |

On the desktop app and VS Code only the one-line edit results apply; the fold
is terminal-only.

## Development

```
npm install
npm run check       # format + lint, type-check, plugin validate, tests; reports in reports/
npm run format      # Biome formatting
npm run lint:fix    # Biome safe fixes
claude --plugin-dir .   # run Claude Code with this working copy loaded
```

`npm run check` writes `reports/summary.md` plus JUnit files for the lint and
test results. The type-check needs Claude Code's API types, which Claude Code
writes into `.claude-plugin/types/` the first time a session loads the mod
from this folder (`claude --plugin-dir .`); without them it is skipped (set
`CC_API_TYPES` to a `claude-code.d.ts` to point at one).

How the mod works, the rules it follows and what to check after a Claude Code
update: [docs/MAINTAINING.md](docs/MAINTAINING.md).

## License

[MIT](LICENSE)
