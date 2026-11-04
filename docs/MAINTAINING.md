# Maintaining cc-compact-view

How the mod decides what to draw, how it stays safe, and what to check when
Claude Code changes. For what it does and how to install it, see the
[README](../README.md).

## Behaviour rules

**What folds.** Edit, MultiEdit, Write, NotebookEdit, Bash, PowerShell, Read,
Grep, Glob, WebFetch, WebSearch, Agent (subagent launches) and every MCP tool
(`isFoldable` in `hooks/kinds.ts`). The line counts them by kind:

| Kind | Wording |
| --- | --- |
| file changes (Edit/Write/notebook, and files a Bash command changed) | `updated N files`, `created N files`, `deleted N files`, `edited N notebooks`, plus total `+added −removed` |
| Bash / PowerShell | `ran N shell commands` |
| Read | `read N files` |
| Grep / Glob | `searched N patterns` |
| WebFetch / WebSearch | `made N web lookups` |
| Agent | `launched N agents` |
| MCP tools | `called N MCP tools` |

**What a run is.** Finished foldable calls in one conversation (the main one,
or one subagent's) with nothing drawn between them: no text from Claude, no
thinking update shown in the transcript, no prompt or notification. A run of
one call is not folded (an edit still gets its one-line result).

**What ends a run and stays visible:**

- a running call: its row stays (the command, the ctrl+b hint; a foreground
  subagent while it works) and joins the run line when it finishes;
- any other tool: AskUserQuestion, plan prompts, Skill, ...;
- a live engine group (one of its calls still running) draws as usual and
  excludes nothing: the engine may later move a finished call out of it (a
  command that changed files gets a row of its own) and never draw that
  group again, so an exclusion would stick for good;
- a finished engine group line ("Ran 2 shell commands") that can't fold whole
  (a call that isn't foldable, or the transcript splits it differently from
  the engine): it draws as usual and its calls leave every run
  (`stockGrouped`), so a run line can never sit inside it.

**Failed calls fold too** (a non-zero exit, a refused edit), as Claude Code's
own group line folds them: they count as their kind, with no separate
"failed" mark; opening the run shows the error. A failed call outside any
run draws its error as usual.

**Never changed:** an edit held for review, the permission dialog, ctrl+o and
`--verbose`, a Bash command's output outside a closed run. On the desktop and
VS Code surfaces only the one-line edit results apply; the fold is
terminal-only.

A `/compact-view` switch changes the fold at once; one-line edit results keep
how they were first drawn.

## Safety: what happens when something breaks

Every hook has a `.catch`. Any error or timeout (the engine's budget is 10 s
per hook) calls `fallBack`, then `trip()` in `hooks/switch.ts`, which:

1. turns the mod off for the rest of the session (`isActive()` is false, so
   every hook passes straight to the engine);
2. shows a toast and a transcript line: *"cc-compact-view hit an error and
   turned itself off ... the mod needs a fix. /compact-view shows the
   error."*;
3. redraws every row (`$.ui.invalidate('ui.render')`) the normal way.

`/compact-view` then prints the error; `/compact-view on` or
`/reload-plugins` tries again. A failure in the `tool.call` hook never blocks
or re-runs the call (`next` is replay-safe in a `.catch`).

**Rule to keep:** never swallow an error inside the fold (`foldState`,
`transcript`). If one row fell back to stock while the rest of its run stayed
hidden, those rows would vanish. Errors must reach the hook's `.catch` so the
whole mod trips off.

**But a disagreement is not an error.** The transcript and the engine's own
grouping can split calls differently. That is handled in place: the group
draws stock, leaves the runs, and everything redraws (`redrawAll`). Only a
real failure trips the mod.

Not covered: if the module fails to *load* (e.g. an API change after a
Claude Code update), Claude Code runs without it; the reason is only in
`claude --debug` output (`cc-compact-view: ...`).

## How it works

**One-line results** (`ToolResult` hook in `results.tsx`): the summary is a
`clickableLine` holding `drawLine`; a click flips `isDiffOpen` for that call, and
the open drawing is the summary followed by the engine's own diff
(`next(e)`). For Bash, `bashEditDiff` is stripped from the output and one
line per changed file follows the command's normal output.

**The fold** (`fold.tsx`, `runs.ts`, `transcript.ts`):

- `tool.call` (foldable tools) writes `running`, then the outcome
  (`{ files }`, `{ files: [], isFailed }`, or `stock` for an edit held for
  review) into the `calls` state, and calls `readAgain`. For a subagent's call it
  also records `owners[tool_use_id] = agentId`, since render events don't say
  whose a row is. The writes redraw every row that read them.
- A row reads its conversation's transcript once per call made (shared promise
  per conversation, failed reads not cached), in two forms:
  `$.session.messages({ as: 'api', agentId })` for the order and the breaks
  (only it keeps thinking blocks) and `$.session.messages({ agentId })` for
  each call's stored result. `flatten` builds the ordered call list marking
  breaks; `runOf` finds the run holding a call.
- The run's **first** row (a standalone `ToolUse`, or an engine `ToolGroup`
  line) draws the run line; every other row of the run draws an empty `Box`,
  and so does its `ToolResult`.
- Open (`isOpen` for the run, keyed by its first call): the head draws the
  run line followed by its normal row, the other rows draw normally, and an
  engine group is forced `isExpanded: true` so its calls show as rows. The
  run's last call adds the `Collapse:` line (`collapseLine`): under its
  result for a standalone row, or at the end of the group's drawing when the
  last call sits in an engine group.

## Files

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | manifest; bump `version` for every release; `types` names the state contract |
| `.claude-plugin/marketplace.json` | makes the repository its own marketplace (`source: "./"`) |
| `hooks/hooks.json` | the one hooks module: `register.tsx` |
| `hooks/register.tsx` | the entry: `session.start` (registers `/compact-view`), `command.run`; calls `registerResults` and `registerFold` |
| `hooks/results.tsx` | the `ToolResult` hook: one-line results, the diff click, shell file lines, hiding results of a closed run, the bottom `Collapse:` line (`isDiffOpen` state) |
| `hooks/fold.tsx` | the fold's hooks (`tool.call`, `ToolUse`, `ToolGroup`) and the run line (`drawRun`, `collapseLine`) |
| `hooks/runs.ts` | which run a call belongs to (`runOf`, `foldState`, `isHidden`), the call outcomes (`outcomeOf`, `stateOf`), `stockGrouped`; owns the `calls`, `owners` and `isOpen` state |
| `hooks/transcript.ts` | reads a conversation's calls in order with their breaks (`flatten`), cached per conversation until the next call (`readAgain`) |
| `hooks/kinds.ts` | the tool kinds a run folds and their wording (`isFoldable`, `summarize`): add a kind there |
| `hooks/changes.ts` | what a call changed: `fileChange`, `bashChanges`, line counting, `relative` paths, the tool sets |
| `hooks/draw.tsx` | `drawLine`, `clickableLine`, `plural`, `safe`, `GUTTER`, `TEXT_INDENT` |
| `hooks/switch.ts` | the on/off switch and its store, the safety switch (`trip`, `fallBack`), `isFolding`, `redrawAll`, the plugin and command names |
| `types/index.d.ts` | `$.state` contract: `calls` (outcome per call, shape tag `calls-3`), `owners` (subagent per call, `owners-1`), `isOpen` (per run), `isDiffOpen` (per one-line result) |
| `tests/*.test.tsx` | `claude plugin test` suites: `register` (one-line results, diff click, toggle), `fold` (runs, clicks, groups), `runs` (thinking breaks, running calls, disagreeing groups, failed calls, agents/MCP, subagent views, bottom collapse line), `safety` (forced failures fall back) |
| `tests/kit.tsx` | test-only: the fake engine, transcript rows and calls, the components a test mounts, and checks (`isStock`, `isBlank`, `runLineOf`) |
| `scripts/check.mjs` | runs every check, writes `reports/` |
| `scripts/typecheck.mjs` | finds Claude Code's API types and runs `tsc` against them |
| `scripts/demo.mjs` | writes `docs/demo.svg`, the README's animated example (mocked data); `npm run demo` after changing what the run line says |
| `scripts/version.mjs` | checks plugin.json, package.json, the lockfile, the newest CHANGELOG entry (and a release tag) agree |
| `.github/workflows/release.yml` | on a `v*` tag: version check, then a GitHub Release from the CHANGELOG |
| `.github/dependabot.yml` | monthly grouped update pull requests for npm dev tools and actions |
| `biome.json` | formatting and lint rules (Biome) |
| `.github/workflows/ci.yml` | `npm run check` on push, pull request and weekly against the newest Claude Code |

## Engine quirks this depends on (re-check after Claude Code updates)

- **Spacing:** both a standalone tool row and an engine group line draw their
  blank line *inside* their own drawing. So the run line is wrapped in
  `marginTop={1}`, and hidden rows draw an empty `Box` (no blank line).
  `marginTop={-1}` on an empty Box did nothing.
- **Group clicks:** clicking a row inside an engine group flips the group's
  own `isExpanded`. While the run is open the run's state must win, or the run
  line disappears.
- **Hover:** the run line and the one-line results are `Button`s with
  `plain dimColor` and `hover={{ inverse: false }}` inside a keyed `Box` (a
  hover style is refused outside one): dim at rest, brighter under the
  pointer, no inverted background.
- **Thinking updates** shown in the transcript are `thinking` blocks with
  text (most thinking blocks are empty). Only the API form of the transcript
  has them.
- **Subagents:** render events carry no `agentId`; only `tool.call` does.
- **Bash file changes** come from `output.bashEditDiff`, an internal,
  undocumented field. Claude Code only fills it when the session runs inside a
  git repository; without it, Bash changes are not counted (not a mod bug).
- **Static scan rules** (`claude plugin validate` refuses the module
  otherwise):
  - `memberOf(family, ...)` must be written at each `read`/`update` call
    site, not returned from a helper;
  - an atom is read and updated only in the file that defines it, with its
    `plugin` and `key` as string literals (so `runs.ts` exports `recordCall`,
    `recordOwner`, `toggleRun` instead of the atoms);
  - a `.catch` handler is a function literal written there
    (`.catch(($, e, next) => fallBack($, 'where', e, next))`), not a call that
    returns one;
  - `$` may be passed into another file only through a `function`
    declaration (not an arrow function const);
  - never name a variable `on` (it shadows the register argument);
  - no raw invisible Unicode characters in source (use escapes, see `UNSAFE`;
    that is also why it is a `new RegExp` with a `biome-ignore`).

## Changing it

1. Try changes live: `claude --plugin-dir .` from the repository root loads
   this working copy and reloads it on every save. Don't have an installed
   copy and a `--plugin-dir` copy loaded in one session at once: both would
   draw.
2. Gate: `npm run check` (Biome, type-check, `claude plugin validate --strict`,
   `claude plugin test`). All must pass; `reports/summary.md` has the table.
   The type-check uses the API types the step-1 session wrote into
   `.claude-plugin/types/` (git-ignored); the same file describes the whole
   mod API: grep `.claude-plugin/types/claude-code/index.d.ts` for
   `ToolResult: {`, `ToolGroup: {`, `HookBudget`, etc.
3. If a change alters the shape of a stored state value, bump its shape tag
   (`calls-3` → `calls-4`, `owners-1` → `owners-2`), so values an older
   version stored are read as empty.
4. Release: bump `version` in `.claude-plugin/plugin.json` and `package.json`
   (`npm install` then updates `package-lock.json`), add a
   `## <version> (<date>)` entry at the top of `CHANGELOG.md`; `npm run check`
   fails until all four agree (`scripts/version.mjs`). Commit, push, then tag:
   `git tag v<version> && git push origin v<version>`. The `release` workflow
   checks the tag matches and publishes a GitHub Release with that CHANGELOG
   entry as its notes. Installed copies pick the new version up with
   `claude plugin update cc-compact-view@cc-compact-view`, then
   `/reload-plugins` or a restart.

Dependabot (`.github/dependabot.yml`) opens one grouped pull request a month
for npm dev tools and one for GitHub Actions; merge when CI is green. Those
pull requests also keep the repository active, which keeps the weekly
scheduled CI run from being switched off after 60 idle days.

## After a Claude Code update

Run `npm run check`. If the toast "cc-compact-view hit an error" shows up in
a session, run `/compact-view` for the error, then check the quirks list:
renamed render props (`ToolUse`, `ToolResult`, `ToolGroup`), the
`bashEditDiff` field, the spacing, and the validator rules. Until it's fixed,
`/compact-view off` keeps the normal view.

## Known limits

- A message sent while Claude works (mid-turn) may not end a run in the
  transcript's API form; the run line can then sit above it.
- A stock engine group splits the runs around it, so a turn with one can show
  two run lines instead of one.
- Folding inside a subagent's view needs the mod to have seen that
  subagent's calls being made: subagents started before the mod loaded, or
  ones whose transcript the session can no longer read, stay stock.
- The transcript is read again after every foldable call; fine in long
  sessions so far, not measured on very large ones. A read past the hook
  budget trips the mod off rather than hanging the screen.
- `claude plugin test` has no coverage output, so there is no coverage report.
