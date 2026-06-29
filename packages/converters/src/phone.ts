import { ParseResult } from '@diamondjs/runtime'

/**
 * Phone converter (DDR §5.8 battery). There is no Intl equivalent, and
 * libphonenumber (200KB+) would detonate the bundle ethos — so this is a
 * deliberately-simple North American formatter.
 *
 * The model holds the canonical 10-digit string ("5551234567"); the view shows
 * "(555) 123-4567". The limitation IS the teaching example:
 *
 *   >>> SEAM: implement your own converter for other regions / E.164. <<<
 *
 * @example  value.two-way="phone | PhoneConverter()"
 */
export class PhoneConverter {
  /** canonical 10-digit string → "(555) 123-4567" */
  static format(value: string): string {
    const digits = (value ?? '').replace(/\D/g, '')
    if (digits.length !== 10) return value ?? '' // pass through partials unformatted
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  /** any NA phone input → canonical 10-digit string, validated */
  static parse(raw: string): ParseResult<string> {
    const digits = raw.replace(/\D/g, '')
    // Accept a leading NA country code (1).
    const national =
      digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
    if (national.length !== 10) {
      return ParseResult.fail(
        raw,
        'Enter a 10-digit North American phone number'
      )
    }
    return ParseResult.ok(national, raw)
  }
}
