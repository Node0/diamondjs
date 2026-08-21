#!/usr/bin/env tsx
/**
 * Repo-gate wrapper for the stink gate (DDR §3.4). The gate logic lives in
 * packages/dev/src/stink-check.ts (published as the @diamondjs/dev
 * `stink-check` bin); this wrapper injects the compiler SOURCE so the repo
 * gate never depends on a stale dist build.
 *
 * Modes:
 *   tsx tools/stink-check.ts            # --check (default): CI gate
 *   tsx tools/stink-check.ts --update   # rewrite the declared-raw baseline
 */
import { DiamondCompiler } from '../packages/compiler/src/index'
import { runStinkGate } from '../packages/dev/src/stink-check'

runStinkGate(new DiamondCompiler(), process.argv)
