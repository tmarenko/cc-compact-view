// Runs every check (version agreement, Biome, tsc, plugin validate, tests)
// and writes the reports to reports/:
//   biome.junit.xml   formatting and lint findings
//   typecheck.txt     tsc output (see scripts/typecheck.mjs)
//   validate.json     `claude plugin validate --strict --json`
//   tests.txt         `claude plugin test` output
//   tests.junit.xml   the same tests as JUnit, for CI test views
//   summary.md        one row per check; also appended to $GITHUB_STEP_SUMMARY
// Every check runs even after one fails; the exit code is 1 if any failed.

import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reports = join(root, 'reports')
mkdirSync(reports, { recursive: true })
const isCi = Boolean(process.env.CI)

function exec(command, args, shell = false) {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell, maxBuffer: 64 * 1024 * 1024 })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  return {
    status: result.error ? 1 : (result.status ?? 1),
    output: result.error?.message ?? output,
    ms: performance.now() - started,
  }
}

// `claude` is an .exe on Windows and a script elsewhere.
const claude = (...args) => exec('claude', args, process.platform === 'win32')
const node = (...args) => exec(process.execPath, args)

const xml = text => text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)

// `claude plugin test` prints a "<file>:" line per file, then "(pass) name [12.3ms]" or "(fail) ...".
function testsToJunit(output) {
  const suites = new Map()
  let file = 'tests'
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^(\S+\.test\.tsx?):$/)
    if (header) file = header[1].replaceAll('\\', '/')
    const row = line.match(/^\((pass|fail|skip)\) (.*?)(?: \[([\d.]+)ms\])?$/)
    if (!row) continue
    if (!suites.has(file)) suites.set(file, [])
    suites.get(file).push({ state: row[1], name: row[2], seconds: (Number(row[3] ?? 0) / 1000).toFixed(3) })
  }
  const body = [...suites]
    .map(([name, cases]) => {
      const failures = cases.filter(c => c.state === 'fail').length
      const skipped = cases.filter(c => c.state === 'skip').length
      const rows = cases.map(c => {
        const inner = c.state === 'fail' ? '<failure message="failed"/>' : c.state === 'skip' ? '<skipped/>' : ''
        return `    <testcase classname="${xml(name)}" name="${xml(c.name)}" time="${c.seconds}">${inner}</testcase>`
      })
      return `  <testsuite name="${xml(name)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}">\n${rows.join('\n')}\n  </testsuite>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="claude plugin test">\n${body}\n</testsuites>\n`
}

const steps = [
  {
    name: 'Version (manifests + CHANGELOG)',
    report: '',
    run: () => node(join(root, 'scripts', 'version.mjs')),
  },
  {
    name: 'Format + lint (Biome)',
    report: 'biome.junit.xml',
    run: () =>
      node(
        join(root, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'),
        'ci',
        '.',
        `--reporter=${isCi ? 'github' : 'default'}`,
        '--reporter=junit',
        `--reporter-file=${join(reports, 'biome.junit.xml')}`,
      ),
  },
  {
    name: 'Type-check (tsc)',
    report: 'typecheck.txt',
    run: () => {
      const result = node(join(root, 'scripts', 'typecheck.mjs'))
      writeFileSync(join(reports, 'typecheck.txt'), result.output)
      if (result.output.includes('typecheck: skipped')) result.note = 'skipped: no Claude Code API types'
      return result
    },
  },
  {
    name: 'Plugin validate (strict)',
    report: 'validate.json',
    run: () => {
      writeFileSync(join(reports, 'validate.json'), claude('plugin', 'validate', '.', '--strict', '--json').output)
      return claude('plugin', 'validate', '.', '--strict')
    },
  },
  {
    name: 'Tests (claude plugin test)',
    report: 'tests.txt, tests.junit.xml',
    run: () => {
      const result = claude('plugin', 'test', '.')
      writeFileSync(join(reports, 'tests.txt'), result.output)
      writeFileSync(join(reports, 'tests.junit.xml'), testsToJunit(result.output))
      const pass = result.output.match(/(\d+) pass/)?.[1]
      const fail = result.output.match(/(\d+) fail/)?.[1]
      if (pass !== undefined) result.note = `${pass} passed, ${fail ?? 0} failed`
      return result
    },
  },
]

const rows = []
let failed = 0
for (const step of steps) {
  console.log(`\n=== ${step.name}`)
  const result = step.run()
  process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`)
  const ok = result.status === 0
  if (!ok) failed++
  rows.push(
    `| ${step.name} | ${ok ? 'pass' : 'FAIL'} | ${result.note ?? ''} | ${(result.ms / 1000).toFixed(1)}s | ${step.report} |`,
  )
}

const version = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version
const claudeVersion = claude('--version').output.trim()
const summary = [
  `## cc-compact-view ${version} checks`,
  '',
  `Claude Code ${claudeVersion}, Node ${process.version}, ${process.platform}`,
  '',
  '| Check | Result | Details | Time | Report |',
  '| --- | --- | --- | --- | --- |',
  ...rows,
  '',
].join('\n')
writeFileSync(join(reports, 'summary.md'), summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
console.log(`\n${summary}`)
process.exit(failed ? 1 : 0)
