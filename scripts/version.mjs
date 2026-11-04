// Checks that every place naming the version agrees:
// .claude-plugin/plugin.json, package.json, package-lock.json and the newest
// CHANGELOG.md entry ("## <version> (<date>)").
//   --tag v1.2.3     the release tag must match too
//   --notes <file>   writes that version's CHANGELOG section (the release notes)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')
const arg = name => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const changelog = read('CHANGELOG.md')
const sections = changelog.split(/^## /m).slice(1)
const newest = sections[0]?.match(/^(\S+)/)?.[1]

const found = {
  '.claude-plugin/plugin.json': JSON.parse(read('.claude-plugin/plugin.json')).version,
  'package.json': JSON.parse(read('package.json')).version,
  'package-lock.json': JSON.parse(read('package-lock.json')).version,
  'CHANGELOG.md (newest entry)': newest,
}
const tag = arg('--tag')
if (tag) found.tag = tag.replace(/^v/, '')

const version = found['.claude-plugin/plugin.json']
const wrong = Object.entries(found).filter(([, v]) => v !== version)
if (wrong.length) {
  console.error(`version: plugin.json says ${version}, but:`)
  for (const [where, v] of wrong) console.error(`  ${where}: ${v ?? 'missing'}`)
  process.exit(1)
}
console.log(`version: ${version} everywhere`)

const notes = arg('--notes')
if (notes) writeFileSync(notes, `${sections[0].split('\n').slice(1).join('\n').trim()}\n`)
