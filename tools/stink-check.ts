#!/usr/bin/env tsx
/**
 * DiamondJS stink gate (DDR §3.4) — the two-tier security audit.
 *
 *   - error (retired/unknown command)            → FAIL (broken source)
 *   - stink:warn (unsafe sink, no raw declared)  → FAIL (hard gate; any > 0 blocks)
 *   - stink:declared (intentional raw)           → baselined; drift reported, NOT gated
 *
 * The asymmetry is intentional: stink:warn is a latent hole nobody declared, so it
 * blocks. stink:declared is an audited escape hatch — adding one is allowed; it just
 * changes stink-baseline.json, and THAT diff lands in code review (the tripwire is
 * review visibility, not a build block).
 *
 * Modes:
 *   tsx tools/stink-check.ts            # --check (default): CI gate
 *   tsx tools/stink-check.ts --update   # rewrite the declared-raw baseline
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'fs'
import { join, relative } from 'path'
import { DiamondCompiler } from '../packages/compiler/src/index'

const ROOT = process.cwd()
const BASELINE_PATH = join(ROOT, 'stink-baseline.json')
const IGNORE = new Set([
  'node_modules',
  'dist',
  '.git',
  '.parcel-cache',
  'coverage',
  'README_files',
  '.memory',
  // Reference material (prior-project code, vendored docs/examples) — not
  // DiamondJS source; must not enter the gate.
  'reference_files',
])

// Mirror of the parcel transformer's detection (kept inline so the gate has no
// dependency on a built dist — it reads compiler source directly).
const DIAMOND_RE =
  /\.\s*(set|rawset|bind|rawbind|to-view|from-view|two-way|calls|capture|one-time|trigger|delegate)\s*=/i
const INTERP_RE = /\$\{[^}]+\}/
function isDiamondTemplate(code: string): boolean {
  return DIAMOND_RE.test(code) || INTERP_RE.test(code)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

interface DeclaredRecord {
  id: string
  file: string
  line: number
  property: string
  op: string
  expression: string
}

function collect() {
  const compiler = new DiamondCompiler()
  const declared: DeclaredRecord[] = []
  const warns: { file: string; line: number; message: string }[] = []
  const errors: { file: string; line: number; message: string }[] = []

  for (const file of walk(ROOT)) {
    const code = readFileSync(file, 'utf-8')
    if (!isDiamondTemplate(code)) continue
    const rel = relative(ROOT, file)
    const result = compiler.compile(code, { filePath: rel, sourceMap: false })
    for (const d of result.diagnostics ?? []) {
      const line = d.location?.line ?? 0
      if (d.severity === 'error') {
        errors.push({ file: rel, line, message: d.message })
      } else if (d.code === 'stink:warn') {
        warns.push({ file: rel, line, message: d.message })
      } else if (d.code === 'stink:declared') {
        declared.push({
          id: `${rel}:${line}:${d.property}:${d.op}`,
          file: rel,
          line,
          property: d.property ?? '',
          op: d.op ?? '',
          expression: d.expression ?? '',
        })
      }
    }
  }
  declared.sort((a, b) => a.id.localeCompare(b.id))
  return { declared, warns, errors }
}

function loadBaseline(): DeclaredRecord[] {
  if (!existsSync(BASELINE_PATH)) return []
  try {
    const j = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
    return Array.isArray(j.declared) ? j.declared : []
  } catch {
    return []
  }
}

function writeBaseline(declared: DeclaredRecord[]): void {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ version: 1, declared }, null, 2) + '\n'
  )
}

const mode = process.argv.includes('--update') ? 'update' : 'check'
const { declared, warns, errors } = collect()

console.log('\n🛡  DiamondJS stink gate\n' + '='.repeat(64))

if (mode === 'update') {
  writeBaseline(declared)
  console.log(
    `\n✅ Baseline updated: ${declared.length} declared raw escape(s) recorded.`
  )
  for (const r of declared) {
    console.log(`   - ${r.id}${r.expression ? `  (${r.expression})` : ''}`)
  }
  console.log()
  process.exit(0)
}

// --- check mode ---
let failed = false

if (errors.length) {
  failed = true
  console.log(`\n❌ ${errors.length} compile error(s) — retired/unknown commands:`)
  for (const e of errors) console.log(`   - ${e.file}:${e.line} ${e.message}`)
}

if (warns.length) {
  failed = true
  console.log(
    `\n❌ ${warns.length} stink:warn — unsafe sink(s) written without raw (hard gate):`
  )
  for (const w of warns) console.log(`   - ${w.file}:${w.line} ${w.message}`)
}

// stink:declared — report drift, but never gate (DDR §3.4)
const baseline = loadBaseline()
const baseIds = new Set(baseline.map((r) => r.id))
const curIds = new Set(declared.map((r) => r.id))
const added = declared.filter((r) => !baseIds.has(r.id))
const removed = baseline.filter((r) => !curIds.has(r.id))
if (added.length || removed.length) {
  console.log(
    '\n⚠️  Declared-raw baseline out of sync (NOT a build blocker — run `npm run stink:update` and commit the diff):'
  )
  for (const r of added) {
    console.log(`   + ${r.id}${r.expression ? `  (${r.expression})` : ''}`)
  }
  for (const r of removed) console.log(`   - ${r.id} (no longer present)`)
} else {
  console.log(`\n✅ ${declared.length} declared raw escape(s); baseline in sync.`)
}

console.log('\n' + '='.repeat(64))
if (failed) {
  console.log('\n❌ STINK GATE FAILED — resolve stink:warn / errors before merge.\n')
  process.exit(1)
}
console.log('\n✅ Stink gate passed.\n')
