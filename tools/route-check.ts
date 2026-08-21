#!/usr/bin/env tsx
/**
 * Repo-gate wrapper for route-check (v2.2 Phase 5). The rule engine and CLI
 * live in packages/dev/src/route-check.ts (published as the @diamondjs/dev
 * `route-check` bin); its test suite lives in packages/dev/tests.
 *
 * Usage:
 *   tsx tools/route-check.ts <routes-module.ts>   # module exporting `routes`
 *                                                 # (or default export)
 */
import { routeCheckMain } from '../packages/dev/src/route-check'

void routeCheckMain()
