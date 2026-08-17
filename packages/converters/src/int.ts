import { ParseResult } from '@diamondjs/runtime'

/**
 * Integer converter (v2.2.1 battery — promoted from the router reference
 * fixtures). The canonical converter for numeric route params
 * (`params: { docId: IntConverter }`); equally usable on form bindings.
 * The model holds a plain integer `number`; the view shows its decimal form.
 *
 * @example  params: { runId: IntConverter }
 * @example  value.two-way="quantity | IntConverter"
 */
export class IntConverter {
  /** integer → decimal string */
  static format(value: number): string {
    if (typeof value !== 'number' || !Number.isInteger(value)) return ''
    return String(value)
  }

  /** decimal string → integer, validated (strict: no floats, no stray text) */
  static parse(raw: string): ParseResult<number> {
    const trimmed = raw.trim()
    if (trimmed === '') return ParseResult.fail(raw, 'Required')
    if (!/^-?\d+$/.test(trimmed)) {
      return ParseResult.fail(raw, `"${raw}" is not a whole number`)
    }
    const n = Number(trimmed)
    if (!Number.isSafeInteger(n)) {
      return ParseResult.fail(raw, `"${raw}" is out of the safe integer range`)
    }
    return ParseResult.ok(n, raw)
  }
}
