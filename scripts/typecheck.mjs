// Type-checks the mod against Claude Code's plugin API declarations.
//
// The declarations are not published: Claude Code writes them itself.
// They are looked up in this order:
//   1. CC_API_TYPES: a path to a claude-code.d.ts (or a claude-code/index.d.ts)
//   2. .claude-plugin/types/, laid beside the mod each time a session loads it
//      with `claude --plugin-dir .`; the repository's tsconfig.json extends it
//   3. the newest copy the plugin-authoring skill wrote under the temp folder
// With none found the check is skipped (exit 0), or fails with --require.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = process.argv.includes('--require')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

function run(project) {
  const result = spawnSync(process.execPath, [tsc, '--pretty', 'false', '-p', project], { stdio: 'inherit' })
  return result.status ?? 1
}

function newestSkillTypes() {
  const base = join(tmpdir(), 'claude', 'bundled-skills')
  if (!existsSync(base)) return undefined
  const found = []
  for (const version of readdirSync(base)) {
    for (const hash of readdirSync(join(base, version))) {
      const file = join(base, version, hash, 'plugin-authoring', 'types', 'claude-code.d.ts')
      if (existsSync(file)) found.push({ file, time: statSync(file).mtimeMs })
    }
  }
  return found.sort((a, b) => b.time - a.time)[0]?.file
}

// The compiler options the declarations' own header gives for a hooks module.
function checkAgainst(declarations) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-compact-view-tsc-'))
  const config = {
    compilerOptions: {
      target: 'es2023',
      lib: ['es2023'],
      types: [],
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      jsx: 'react',
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
    },
    include: [declarations, ...['hooks', 'types', 'tests'].map(d => join(root, d))].map(p => p.replaceAll('\\', '/')),
  }
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2))
  try {
    return run(join(dir, 'tsconfig.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const fromEnv = process.env.CC_API_TYPES
const laid = join(root, '.claude-plugin', 'types', 'tsconfig.json')
let status
if (fromEnv) {
  console.log(`typecheck: using CC_API_TYPES=${fromEnv}`)
  status = checkAgainst(resolve(fromEnv))
} else if (existsSync(laid)) {
  console.log('typecheck: using .claude-plugin/types/ (laid by Claude Code)')
  status = run(join(root, 'tsconfig.json'))
} else {
  const skill = newestSkillTypes()
  if (skill) {
    console.log(`typecheck: using ${skill}`)
    status = checkAgainst(skill)
  } else {
    console.log(
      'typecheck: skipped, no Claude Code API types found. Start `claude --plugin-dir .` once, or set CC_API_TYPES.',
    )
    status = require_ ? 1 : 0
  }
}
process.exit(status)
