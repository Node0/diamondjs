import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

/**
 * The second tsconfig run (Lifecycle Contract §10.1): the same lifecycle
 * tests compiled with legacy decorators and [[Set]] class fields. The default
 * run (vitest.config.ts) already compiles the runtime tests with TC39
 * decorators and [[Define]] fields — the toolchain shape issue #11 is about.
 */
export default mergeConfig(
  base,
  defineConfig({
    esbuild: {
      tsconfigRaw: {
        compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
      },
    },
    test: { include: ['packages/runtime/tests/lifecycle/**/*.test.ts'] },
  })
)
