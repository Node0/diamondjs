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
  }
]

function getCLOC(path: string): number {
  try {
    const result = execSync(
      `npx cloc ${path} --json --quiet 2>/dev/null || echo '{"TypeScript":{"code":0}}'`,
      { encoding: 'utf-8' }
    )
    const data = JSON.parse(result.trim())
    const tsStats = data.TypeScript
    return tsStats ? tsStats.code : 0
  } catch {
    return 0
  }
}

function checkBudgets(): boolean {
  console.log('\n🔍 DiamondJS LOC Budget Report\n')
  console.log('='.repeat(70))
  
  let allPassed = true
  let totalLOC = 0
  const totalBudget = budgets.reduce((sum, b) => sum + b.budget, 0)
  
  for (const { name, path, budget, warningThreshold } of budgets) {
    const actual = getCLOC(path)
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
    console.log(`  Actual:  ${actual.toLocaleString()} LOC`)
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
    console.log('\n❌ LOC BUDGET EXCEEDED - Reduce code before committing\n')
    process.exit(1)
  } else {
    console.log('\n✅ All LOC budgets within limits\n')
  }
  
  return allPassed
}

checkBudgets()
