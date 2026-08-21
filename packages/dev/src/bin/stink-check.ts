#!/usr/bin/env node
/**
 * Published bin entry — supplies @diamondjs/compiler's built dist. The
 * repo-gate wrapper (tools/stink-check.ts) supplies the compiler SOURCE
 * instead, so the gate never depends on a stale dist build.
 */
import { DiamondCompiler } from '@diamondjs/compiler'
import { runStinkGate } from '../stink-check'

runStinkGate(new DiamondCompiler(), process.argv)
