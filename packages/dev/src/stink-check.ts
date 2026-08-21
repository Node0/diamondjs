/**
 * DiamondJS stink gate (DDR §3.4) — the two-tier security audit.
 *
 * Routing is by SEVERITY, never by code prefix (§16 D-8 — a non-`stink:` warn
 * like switch-static-dead must not slip the gate):
 *
 *   - severity error    (retired/unknown command, …)  → FAIL (broken source)
 *   - severity warn     (stink:warn, switch-static-dead, …) → FAIL (hard gate)
 *   - severity declared (intentional raw)             → baselined; drift reported, NOT gated
 *   - severity info                                   → advisory, never gated
 *
 * The asymmetry is intentional: stink:warn is a latent hole nobody declared, so it
 * blocks. stink:declared is an audited escape hatch — adding one is allowed; it just
 * changes stink-baseline.json, and THAT diff lands in code review (the tripwire is
 * review visibility, not a build block).
 *
 * Packaged as a @diamondjs/dev bin (v2.2.2). The compiler is INJECTED, never
 * imported here: the published bin supplies @diamondjs/compiler's dist, while
 * the repo-gate wrapper (tools/stink-check.ts) supplies the compiler SOURCE —
 * the gate must never depend on a stale dist build.
 *
 * Modes:
 *   stink-check            # --check (default): CI gate
 *   stink-check --update   # rewrite the declared-raw baseline
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'fs'
import { join, relative } from 'path'
import type { DiamondCompiler } from '@diamondjs/compiler'
import { Print } from '@diamondjs/primafacie'

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
const STRUCTURAL_RE = /<switch[\s>]|repeat\.for\s*=|<outlet[\s>]/i
function isDiamondTemplate(code: string): boolean {
  return DIAMOND_RE.test(code) || INTERP_RE.test(code) || STRUCTURAL_RE.test(code)
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

function collect(compiler: DiamondCompiler, root: string) {
  const declared: DeclaredRecord[] = []
  const warns: { file: string; line: number; message: string }[] = []
  const errors: { file: string; line: number; message: string }[] = []

  for (const file of walk(root)) {
    const code = readFileSync(file, 'utf-8')
    if (!isDiamondTemplate(code)) continue
    const rel = relative(root, file)
    const result = compiler.compile(code, { filePath: rel, sourceMap: false })
    for (const d of result.diagnostics ?? []) {
      const line = d.location?.line ?? 0
      // §16 D-8: route on the severity FIELD, not the code prefix.
      if (d.severity === 'error') {
        errors.push({ file: rel, line, message: d.message })
      } else if (d.severity === 'warn') {
        warns.push({ file: rel, line, message: `[${d.code}] ${d.message}` })
      } else if (d.severity === 'declared') {
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

function loadBaseline(baselinePath: string): DeclaredRecord[] {
  if (!existsSync(baselinePath)) return []
  try {
    const j = JSON.parse(readFileSync(baselinePath, 'utf-8'))
    return Array.isArray(j.declared) ? j.declared : []
  } catch {
    return []
  }
}

function writeBaseline(baselinePath: string, declared: DeclaredRecord[]): void {
  writeFileSync(
    baselinePath,
    JSON.stringify({ version: 1, declared }, null, 2) + '\n'
  )
}

export function runStinkGate(compiler: DiamondCompiler, argv: string[]): void {
  const root = process.cwd()
  const baselinePath = join(root, 'stink-baseline.json')
  const mode = argv.includes('--update') ? 'update' : 'check'
  const { declared, warns, errors } = collect(compiler, root)

  console.log('\n🛡  DiamondJS stink gate\n' + '='.repeat(64))

  if (mode === 'update') {
    writeBaseline(baselinePath, declared)
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
    Print('FAILURE', `${errors.length} compile error(s) — retired/unknown commands:`)
    for (const e of errors) console.log(`   - ${e.file}:${e.line} ${e.message}`)
  }

  if (warns.length) {
    failed = true
    Print(
      'FAILURE',
      `${warns.length} warn-severity diagnostic(s) — unsafe sinks without raw, dead switches, … (hard gate):`
    )
    for (const w of warns) console.log(`   - ${w.file}:${w.line} ${w.message}`)
  }

  // stink:declared — report drift, but never gate (DDR §3.4)
  const baseline = loadBaseline(baselinePath)
  const baseIds = new Set(baseline.map((r) => r.id))
  const curIds = new Set(declared.map((r) => r.id))
  const added = declared.filter((r) => !baseIds.has(r.id))
  const removed = baseline.filter((r) => !curIds.has(r.id))
  if (added.length || removed.length) {
    console.log(
      '\n⚠️  Declared-raw baseline out of sync (NOT a build blocker — run `stink-check --update` and commit the diff):'
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
    Print('CRITICAL', 'STINK GATE FAILED — resolve stink:warn / errors before merge.')
    process.exit(1)
  }
  Print('SUCCESS', 'Stink gate passed.')
}
