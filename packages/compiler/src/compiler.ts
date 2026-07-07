/**
 * DiamondCompiler - Main compiler class
 *
 * Compiles DiamondJS HTML templates to JavaScript code
 * that creates DOM and sets up bindings via instance methods.
 * All compiled output uses 'this' to reference the component instance.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { TemplateParser } from './parser'
import { CodeGenerator } from './generator'
import type {
  CompilerOptions,
  CompileResult,
  ConverterObligation,
  Diagnostic,
  SourceLocation,
  TemplateImport,
} from './types'

/** <!-- @import { A, B } from './mod' --> — the v2.1 provenance directive. */
const IMPORT_DIRECTIVE_RE =
  /<!--\s*@import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*-->/g

/** Any @import-shaped comment (to flag malformed variants loudly). */
const IMPORT_LIKE_RE = /<!--\s*@import\b[\s\S]*?-->/g

/**
 * DiamondCompiler - The main template compiler
 *
 * @example
 * const compiler = new DiamondCompiler()
 * const result = compiler.compile('<input value.bind="name">', {
 *   filePath: 'my-component.html'
 * })
 * console.log(result.code)
 */
export class DiamondCompiler {
  private parser: TemplateParser

  constructor() {
    this.parser = new TemplateParser()
  }

  /**
   * Compile an HTML template to JavaScript
   *
   * @param template - HTML template string
   * @param options - Compiler options
   * @returns Compilation result with code and optional source map
   */
  compile(template: string, options: CompilerOptions = {}): CompileResult {
    // Parse the template
    const nodes = this.parser.parse(template)

    // Generate code
    const generator = new CodeGenerator(options)
    const result = generator.generate(nodes)

    // Merge parser diagnostics (retired/unknown commands) ahead of codegen ones
    // (gate stink). Enforcement happens downstream: the transformer throws on
    // 'error', the stink-check tool gates 'warn' and baselines 'declared'.
    result.diagnostics = [
      ...this.parser.diagnostics,
      ...(result.diagnostics ?? []),
    ]

    // v2.1 (§3.6): scan @import provenance directives from the RAW template
    // (comments never reach the node tree). They let a standalone
    // .diamond.html declare where its pipe heads come from.
    const importScan = this.scanImportDirectives(
      template,
      result.pipeTransforms ?? []
    )
    result.templateImports = importScan.imports
    result.diagnostics.push(...importScan.diagnostics)

    return result
  }

  /**
   * §5.6 obligation verification against an arbitrary import source — public
   * so the Parcel transformer can verify STANDALONE templates against the
   * synthetic imports its @import directives produce (the inject path passes
   * the component source instead, via compileAndInject).
   */
  verifyObligations(
    result: CompileResult,
    importSource: string,
    filePath?: string
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    for (const ob of result.converterObligations ?? []) {
      const diag = this.verifyConverterParse(ob, importSource, filePath)
      if (diag) diagnostics.push(diag)
    }
    return diagnostics
  }

  /**
   * Scan <!-- @import { A, B } from './mod' --> directives (v2.1 grammar,
   * ratified in Amendment A2). v1 restrictions: named imports only — no
   * aliasing, no default/namespace forms. Duplicate names across directives
   * error; names matching no pipe head are flagged info (unused).
   */
  private scanImportDirectives(
    template: string,
    pipeHeads: string[]
  ): { imports: TemplateImport[]; diagnostics: Diagnostic[] } {
    const imports: TemplateImport[] = []
    const diagnostics: Diagnostic[] = []
    const seenNames = new Map<string, string>() // name → spec it came from
    const heads = new Set(pipeHeads)

    const locationAt = (offset: number): SourceLocation => {
      const before = template.slice(0, offset)
      const line = (before.match(/\n/g)?.length ?? 0) + 1
      const column = offset - before.lastIndexOf('\n')
      return { line, column, offset }
    }

    const wellFormed = new Set<string>()
    let m: RegExpExecArray | null
    IMPORT_DIRECTIVE_RE.lastIndex = 0
    while ((m = IMPORT_DIRECTIVE_RE.exec(template)) !== null) {
      wellFormed.add(m[0])
      const location = locationAt(m.index)
      const spec = m[3]
      const names: string[] = []
      let valid = true

      for (const entry of m[1].split(',')) {
        const name = entry.trim()
        if (name === '') continue
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
          diagnostics.push({
            severity: 'error',
            code: 'bad-import-directive',
            message:
              `Invalid name '${name}' in @import directive. Accepted grammar: ` +
              `<!-- @import { Name, other } from './module' --> — named imports only, no aliasing.`,
            location,
          })
          valid = false
          continue
        }
        if (seenNames.has(name)) {
          diagnostics.push({
            severity: 'error',
            code: 'import-directive-duplicate',
            message: `'${name}' is imported by two @import directives ('${seenNames.get(name)}' and '${spec}').`,
            location,
          })
          valid = false
          continue
        }
        seenNames.set(name, spec)
        names.push(name)
        if (!heads.has(name)) {
          diagnostics.push({
            severity: 'info',
            code: 'import-directive-unused',
            message: `@import name '${name}' matches no pipe transform in this template.`,
            location,
          })
        }
      }

      if (valid && names.length > 0) {
        imports.push({ names, spec, location })
      }
    }

    // Malformed @import-shaped comments must fail loudly, not silently no-op
    IMPORT_LIKE_RE.lastIndex = 0
    while ((m = IMPORT_LIKE_RE.exec(template)) !== null) {
      if (!wellFormed.has(m[0])) {
        diagnostics.push({
          severity: 'error',
          code: 'bad-import-directive',
          message:
            `Malformed @import directive: ${m[0].slice(0, 80)}. Accepted grammar: ` +
            `<!-- @import { Name, other } from './module' --> — named imports only, no aliasing/default/namespace.`,
          location: locationAt(m.index),
        })
      }
    }

    return { imports, diagnostics }
  }

  /**
   * Compile a template and inject into a component class
   *
   * @param template - HTML template string
   * @param componentSource - Component TypeScript/JavaScript source
   * @param options - Compiler options
   * @returns Modified component source with injected createTemplate method
   */
  compileAndInject(
    template: string,
    componentSource: string,
    options: CompilerOptions = {}
  ): CompileResult {
    // Compile the template
    const compiled = this.compile(template, options)
    const diagnostics: Diagnostic[] = [...(compiled.diagnostics ?? [])]

    // §5.6: verify each converter obligation by following its import. This is the
    // inject path — componentSource carries the converter's import statement, which
    // the standalone template (compile()) never sees. The compiler follows that
    // import relative to options.filePath and reads the module for `static parse`.
    for (const ob of compiled.converterObligations ?? []) {
      const diag = this.verifyConverterParse(
        ob,
        componentSource,
        options.filePath
      )
      if (diag) diagnostics.push(diag)
    }

    // Find the class to inject into
    const className = options.className || this.detectClassName(componentSource)
    if (!className) {
      throw new CompileError(
        'Could not detect component class name. ' +
          'Specify className in options or ensure file has a class declaration.',
        { line: 1, column: 0 }
      )
    }

    // Inject the createTemplate method
    const injectedSource = this.injectMethod(
      componentSource,
      className,
      compiled.code
    )

    // Add DiamondCore import if needed
    const finalSource = this.ensureImport(injectedSource)

    return { code: finalSource, map: compiled.map, diagnostics }
  }

  /**
   * Verify a converter exposes `static parse` (DDR §5.6) by following its import.
   *
   * Uses a regex scan of `componentSource` for the import (not a full TS parse —
   * the string-based compiler's accepted ceiling), resolves the module path
   * relative to `filePath`, and reads it. Returns:
   *   - error  ('converter-missing-parse') when the module has no `static parse`
   *   - info   ('converter-unresolved')    when the import can't be followed
   *            (bare/package specifier, re-export, missing file) → verify manually
   *   - null   when `static parse` is present
   */
  private verifyConverterParse(
    ob: ConverterObligation,
    componentSource: string,
    filePath?: string
  ): Diagnostic | null {
    const unresolved = (detail: string): Diagnostic => ({
      severity: 'info',
      code: 'converter-unresolved',
      message:
        `Could not follow the import for converter '${ob.name}' (used on a ` +
        `${ob.direction} binding): ${detail}. Verify it exports a static parse method manually.`,
      location: ob.location,
      property: ob.name,
    })

    const importRe = new RegExp(
      `import[^;]*\\b${ob.name}\\b[^;]*from\\s+['"]([^'"]+)['"]`
    )
    const m = componentSource.match(importRe)
    if (!m) return unresolved('no import statement found')
    if (!filePath) return unresolved('no source file path to resolve against')

    const spec = m[1]
    if (!spec.startsWith('.')) {
      return unresolved(`'${spec}' is a package specifier, not a relative path`)
    }

    const mod = this.readModule(spec, dirname(filePath))
    if (!mod) return unresolved(`could not read module '${spec}'`)

    // v2.1 (§3.8): follow re-exports (barrel files) up to 3 hops toward
    // §5.5's "the import graph is the registry".
    const found = this.findStaticParse(ob.name, mod, 3, new Set())
    if (found.status === 'found') return null
    if (found.status === 'unresolved') return unresolved(found.detail)

    return {
      severity: 'error',
      code: 'converter-missing-parse',
      message:
        `Converter '${ob.name}' is used on a ${ob.direction} binding but its ` +
        `module ('${spec}') has no static parse method. ${ob.direction} bindings ` +
        `require parse to validate inbound values (DDR §5.6).`,
      location: ob.location,
      property: ob.name,
    }
  }

  /**
   * Resolve a relative import specifier to a readable module (tries the raw
   * path, .ts/.js, and index.ts/index.js).
   */
  private readModule(
    spec: string,
    baseDir: string
  ): { path: string; source: string } | null {
    const candidates = [
      resolve(baseDir, spec),
      resolve(baseDir, `${spec}.ts`),
      resolve(baseDir, `${spec}.js`),
      resolve(baseDir, spec, 'index.ts'),
      resolve(baseDir, spec, 'index.js'),
    ]
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      try {
        return { path: candidate, source: readFileSync(candidate, 'utf-8') }
      } catch {
        // directory or unreadable — keep trying
      }
    }
    return null
  }

  /**
   * Look for `static parse` in a module, following re-exports (v2.1, §3.8):
   * named re-exports (`export { X } from`, incl. `Y as X` aliasing — followed
   * under the ORIGINAL name) and star re-exports (in order, first hit wins).
   * Depth-capped and cycle-guarded; package-specifier hops stay soft.
   * The `/static\s+parse\b/` module-level check is the string compiler's
   * accepted ceiling (§5.6) — unchanged, just applied across hops.
   */
  private findStaticParse(
    name: string,
    mod: { path: string; source: string },
    depth: number,
    visited: Set<string>
  ):
    | { status: 'found' | 'missing' }
    | { status: 'unresolved'; detail: string } {
    if (/static\s+parse\b/.test(mod.source)) return { status: 'found' }
    if (visited.has(mod.path)) {
      return { status: 'unresolved', detail: 'circular re-export chain' }
    }
    visited.add(mod.path)
    if (depth <= 0) {
      return {
        status: 'unresolved',
        detail: 're-export chain deeper than 3 hops',
      }
    }

    const modDir = dirname(mod.path)

    // Named re-exports: export { A, B as C } from './x'
    const namedRe = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
    let nm: RegExpExecArray | null
    while ((nm = namedRe.exec(mod.source)) !== null) {
      let followName: string | null = null
      for (const entry of nm[1].split(',')) {
        const parts = entry.trim().split(/\s+as\s+/)
        const exported = (parts[1] ?? parts[0]).trim()
        if (exported === name) {
          followName = parts[0].trim()
          break
        }
      }
      if (!followName) continue

      const spec = nm[2]
      if (!spec.startsWith('.')) {
        return {
          status: 'unresolved',
          detail: `re-exported from package '${spec}'`,
        }
      }
      const next = this.readModule(spec, modDir)
      if (!next) {
        return {
          status: 'unresolved',
          detail: `could not read re-export target '${spec}'`,
        }
      }
      return this.findStaticParse(followName, next, depth - 1, visited)
    }

    // Star re-exports: export * from './x' — follow in order
    const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g
    let sm: RegExpExecArray | null
    let unresolvedDetail: string | null = null
    while ((sm = starRe.exec(mod.source)) !== null) {
      const spec = sm[1]
      if (!spec.startsWith('.')) {
        unresolvedDetail = `star re-export from package '${spec}'`
        continue
      }
      const next = this.readModule(spec, modDir)
      if (!next) {
        unresolvedDetail = `could not read star re-export '${spec}'`
        continue
      }
      // Only descend where the name (or a further star) can plausibly live
      if (
        !new RegExp(`\\b${name}\\b`).test(next.source) &&
        !/export\s*\*/.test(next.source)
      ) {
        continue
      }
      const r = this.findStaticParse(name, next, depth - 1, visited)
      if (r.status !== 'missing') return r
    }
    if (unresolvedDetail) {
      return { status: 'unresolved', detail: unresolvedDetail }
    }

    return { status: 'missing' }
  }

  /**
   * Detect the component class name from source
   */
  private detectClassName(source: string): string | null {
    // Match: export class ClassName or class ClassName extends Component
    const classMatch = source.match(
      /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/
    )
    return classMatch ? classMatch[1] : null
  }

  /**
   * Inject the createTemplate method into the class
   */
  private injectMethod(
    source: string,
    className: string,
    methodCode: string
  ): string {
    // Find the class and its closing brace
    // This is a simplified approach - a full implementation would use AST
    // Match class opening, body content (non-greedy), and closing brace
    const classPattern = new RegExp(
      `(class\\s+${className}[^{]*\\{)([\\s\\S]*?)(\\})`,
      'm'
    )

    const match = source.match(classPattern)
    if (!match) {
      throw new CompileError(
        `Could not find class "${className}" in component file`,
        { line: 1, column: 0 }
      )
    }

    const [, classStart, classBody] = match
    const insertIndex = match.index! + classStart.length + classBody.length

    // Inject the method before the closing brace
    const indentedMethod = methodCode
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')

    // Add newlines for proper formatting
    const needsLeadingNewline = classBody.length > 0 && !classBody.endsWith('\n')
    const prefix = needsLeadingNewline ? '\n' : (classBody.length === 0 ? '\n' : '')

    return (
      source.slice(0, insertIndex) +
      prefix +
      indentedMethod +
      '\n' +
      source.slice(insertIndex)
    )
  }

  /**
   * Ensure DiamondCore is imported
   */
  private ensureImport(source: string): string {
    // Check if DiamondCore is already imported
    if (/import\s*\{[^}]*DiamondCore[^}]*\}\s*from/.test(source)) {
      return source
    }

    // Check if there's an existing diamond import to extend
    const diamondImportMatch = source.match(
      /import\s*\{([^}]*)\}\s*from\s*['"]@diamondjs\/runtime['"]/
    )

    if (diamondImportMatch) {
      // Add DiamondCore to existing import
      const existingImports = diamondImportMatch[1]
      const newImports = existingImports.includes('DiamondCore')
        ? existingImports
        : `${existingImports.trim()}, DiamondCore`

      return source.replace(
        diamondImportMatch[0],
        `import { ${newImports} } from '@diamondjs/runtime'`
      )
    }

    // Add new import at the top (after any existing imports)
    const lastImportMatch = source.match(/^(import\s+[\s\S]*?from\s+['"][^'"]+['"];?\n)/m)
    if (lastImportMatch) {
      const insertPos = lastImportMatch.index! + lastImportMatch[0].length
      return (
        source.slice(0, insertPos) +
        "import { DiamondCore } from '@diamondjs/runtime';\n" +
        source.slice(insertPos)
      )
    }

    // No imports - add at the very top
    return "import { DiamondCore } from '@diamondjs/runtime';\n\n" + source
  }
}

/**
 * Compile error with location information
 */
export class CompileError extends Error {
  constructor(
    message: string,
    public location: { line: number; column: number }
  ) {
    super(`${message} at line ${location.line}, column ${location.column}`)
    this.name = 'CompileError'
  }
}
