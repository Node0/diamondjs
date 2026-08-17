/**
 * CI check (v2.2 Phase 7): the three meta-package manifests stay in
 * exact-pin lockstep with the workspace version — one tested constellation,
 * never a range. Red + nonzero exit on any drift (fail closed).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { Print } from '../packages/primafacie/src/primafacie'

const ROOT = process.cwd()
const read = (p: string): { version: string; dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(ROOT, p), 'utf-8'))

const workspaceVersion = read('package.json').version
const metas = ['packages/app/package.json', 'packages/dev/package.json', 'packages/all/package.json']
const failures: string[] = []

for (const meta of metas) {
  const pkg = read(meta)
  if (pkg.version !== workspaceVersion) {
    failures.push(`${meta}: version ${pkg.version} != workspace ${workspaceVersion}`)
  }
  for (const [dep, pin] of Object.entries(pkg.dependencies ?? {})) {
    if (!dep.startsWith('@diamondjs/')) continue
    if (pin !== workspaceVersion) {
      failures.push(`${meta}: ${dep} pinned '${pin}' — must be exact '${workspaceVersion}' (no ranges)`)
    }
  }
}

if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  Print('CRITICAL', `meta-package lockstep BROKEN: ${failures.length} drift(s).`)
  process.exit(1)
}
Print('SUCCESS', `meta-packages in exact-pin lockstep at ${workspaceVersion}.`)
