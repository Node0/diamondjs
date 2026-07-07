import { ParseResult } from '@diamondjs/runtime'

/**
 * Currency converter (DDR §5.8 battery). Thin wrapper over Intl.NumberFormat —
 * does NOT reimplement CLDR. The model holds a plain `number`; the view shows a
 * localized currency string.
 *
 * @example  value.two-way="amount | CurrencyConverter('USD')"
 */
export class CurrencyConverter {
  /** number → localized currency string */
  static format(value: number, currency = 'USD', locale = 'en-US'): string {
    if (typeof value !== 'number' || Number.isNaN(value)) return ''
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
      value
    )
  }

  /**
   * currency string → number, validated.
   *
   * NOTE: parsing is intentionally en-US-shaped (`,` = grouping, `.` = decimal).
   * Other locales should ship their own converter — the import graph is the
   * registry (§5.5); this battery is a worked example, not a CLDR parser.
   */
  static parse(raw: string, _currency = 'USD', _locale = 'en-US'): ParseResult<number> {
    const trimmed = raw.trim()
    if (trimmed === '') return ParseResult.fail(raw, 'Required')

    // Strip everything but digits, sign, separators; drop grouping commas.
    const normalized = trimmed.replace(/[^\d.,\-]/g, '').replace(/,/g, '')
    if (normalized === '' || normalized === '-' || normalized === '.') {
      return ParseResult.fail(raw, `"${raw}" is not a valid amount`)
    }
    const n = Number(normalized)
    if (Number.isNaN(n)) {
      return ParseResult.fail(raw, `"${raw}" is not a valid amount`)
    }
    return ParseResult.ok(n, raw)
  }
}
