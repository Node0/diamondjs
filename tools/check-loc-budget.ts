#!/usr/bin/env tsx
/**
 * DiamondJS LOC Budget Enforcement
 * 
 * Enforces hard constraints from architecture spec:
 * - Runtime: < 2,500 LOC
 * - Compiler: < 5,000 LOC
 * - Parcel Plugin: ~200 LOC
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { Print } from '../packages/primafacie/src/primafacie'

interface LOCBudget {
  name: string
  path: string
  budget: number
  warningThreshold: number
}

const budgets: LOCBudget[] = [
  {
    name: 'Runtime (@diamondjs/runtime)',
    path: 'packages/runtime/src',
    budget: 2500,
    warningThreshold: 2250
  },
  {
    name: 'Compiler (@diamondjs/compiler)',
    path: 'packages/compiler/src',
    budget: 5000,
    warningThreshold: 4500
  },
  {
    name: 'Parcel Transformer (@diamondjs/parcel-transformer-diamond)',
    path: 'packages/parcel-plugin/src',
    budget: 300,
    warningThreshold: 250
  },
  {
    name: 'Converters (@diamondjs/converters)',
    path: 'packages/converters/src',
    budget: 500,
    warningThreshold: 400
  },
  {
    name: 'Primafacie (@diamondjs/primafacie)',
    path: 'packages/primafacie/src',
    budget: 400,
    warningThreshold: 350
  }
]

/**
 * Run cloc and return TypeScript LOC. §16 D-9: fail CLOSED — a cloc
 * resolution failure (offline, no npx cache) must exit nonzero and red,
 * never be swallowed into a green 0-LOC report.
 */
function runCloc(path: string, extraArgs: string[] = []): number {
  let result: string
  try {
    result = execSync(
      ['npx', 'cloc', path, '--json', '--quiet', ...extraArgs].join(' '),
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (error) {
    Print(
      'CRITICAL',
      `cloc failed for ${path} — cannot measure, failing closed (D-9). ${String(error)}`
    )
    process.exit(1)
  }
  try {
    const data = JSON.parse(result.trim() || '{}')
    return data.TypeScript ? data.TypeScript.code : 0
  } catch {
    Print('CRITICAL', `cloc output unparseable for ${path} — failing closed (D-9).`)
    process.exit(1)
  }
}

/**
 * Production LOC = src excluding __tests__ (only production code counts
 * against the budget). Test LOC — in-src __tests__ plus the package's
 * sibling tests/ dir — is reported as a separate informational column.
 */
function getPackageLOC(srcPath: string): { production: number; tests: number } {
  const production = runCloc(srcPath, ['--exclude-dir=__tests__'])
  let tests = 0
  const inSrcTests = join(srcPath, '__tests__')
  if (existsSync(inSrcTests)) tests += runCloc(inSrcTests)
  const siblingTests = join(dirname(srcPath), 'tests')
  if (existsSync(siblingTests)) tests += runCloc(siblingTests)
  return { production, tests }
}

function checkBudgets(): boolean {
  console.log('\n🔍 DiamondJS LOC Budget Report\n')
  console.log('='.repeat(70))
  
  let allPassed = true
  let totalLOC = 0
  const totalBudget = budgets.reduce((sum, b) => sum + b.budget, 0)
  
  for (const { name, path, budget, warningThreshold } of budgets) {
    const { production: actual, tests } = getPackageLOC(path)
    totalLOC += actual

    const percentage = (actual / budget * 100).toFixed(1)
    const delta = actual - budget
    const status = actual > budget
      ? '❌ OVER'
      : actual > warningThreshold
        ? '⚠️  WARN'
        : '✅ OK'

    const bar = '█'.repeat(Math.min(20, Math.floor(actual / budget * 20)))
    const emptyBar = '░'.repeat(20 - bar.length)

    console.log(`\n${name}:`)
    console.log(`  Status:  ${status}`)
    console.log(`  Usage:   [${bar}${emptyBar}] ${percentage}%`)
    console.log(`  Actual:  ${actual.toLocaleString()} LOC (production)`)
    console.log(`  Tests:   ${tests.toLocaleString()} LOC (informational, not budgeted)`)
    console.log(`  Budget:  ${budget.toLocaleString()} LOC`)
    
    if (delta > 0) {
      console.log(`  Delta:   +${delta} LOC (${((delta/budget)*100).toFixed(1)}% over budget)`)
      allPassed = false
    } else {
      const remaining = budget - actual
      console.log(`  Delta:   ${remaining.toLocaleString()} LOC remaining`)
    }
  }
  
  console.log('\n' + '='.repeat(70))
  console.log(`\n📊 Summary:`)
  console.log(`   Total LOC:    ${totalLOC.toLocaleString()}`)
  console.log(`   Total Budget: ${totalBudget.toLocaleString()}`)
  console.log(`   Usage:        ${((totalLOC / totalBudget) * 100).toFixed(1)}%`)
  
  if (!allPassed) {
    Print('CRITICAL', 'LOC BUDGET EXCEEDED - Reduce code before committing')
    process.exit(1)
  } else {
    Print('SUCCESS', 'All LOC budgets within limits')
  }
  
  return allPassed
}

checkBudgets()
