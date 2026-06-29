import { ParseResult } from '@diamondjs/runtime'

/**
 * Date converter (DDR §5.8 — the highest-value battery). A correct `parseDate`
 * handling calendar validity AND the offset-reconstruction problem is exactly
 * what most devs get wrong.
 *
 * The model holds a `Date`; the view shows a localized date string. To avoid the
 * offset drift §5.1 warns about, an ISO date-only input (`YYYY-MM-DD`) is parsed
 * as **UTC midnight** — never re-derived against a local wall clock.
 *
 * @example  value.two-way="dueDate | DateConverter()"
 */
export class DateConverter {
  /** Date → localized date string */
  static format(
    value: Date,
    locale = 'en-US',
    options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }
  ): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
    return new Intl.DateTimeFormat(locale, options).format(value)
  }

  /** date string → Date, validated (calendar validity + offset-safe) */
  static parse(raw: string): ParseResult<Date> {
    const trimmed = raw.trim()
    if (trimmed === '') return ParseResult.fail(raw, 'Required')

    // Preferred form: ISO date-only → UTC midnight (no offset ambiguity).
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (iso) {
      const [, y, m, d] = iso
      const year = +y
      const month = +m - 1
      const day = +d
      const date = new Date(Date.UTC(year, month, day))
      // Calendar validity: JS Date rolls over (Feb 30 → Mar 2); reject that.
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
      ) {
        return ParseResult.fail(raw, `"${raw}" is not a valid calendar date`)
      }
      return ParseResult.ok(date, raw)
    }

    // Fallback: native parse. Ambiguous w.r.t. offset for non-ISO inputs — prefer
    // the ISO form above for round-trip safety.
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return ParseResult.fail(raw, `"${raw}" is not a valid date`)
    return ParseResult.ok(new Date(t), raw)
  }
}
