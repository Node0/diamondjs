/**
 * ParseResult<T> — the result of a `parse` (string → value, validated).
 *
 * DiamondJS's client-side validation story (DDR §5.7): a `parse` already had to
 * validate (you can't turn "abc" into a number without deciding it isn't one), so
 * that responsibility is made explicit. The from-view binding consumes this:
 *
 *   - valid   → write `value` to the model
 *   - invalid → do NOT write (model keeps its last good value); the input keeps
 *               showing `raw` (never clobber what the user is typing); `valid` +
 *               `error` are exposed to the validation surface.
 *
 * `parse` owns type/format validity ("is this a valid currency string"), NOT
 * business rules ("amount < $10,000") — those live in the component.
 */
export interface ParseResult<T> {
  /** Whether `raw` parsed to a valid value */
  valid: boolean
  /** The parsed value when valid; null otherwise */
  value: T | null
  /** The user's in-progress text — never clobbered */
  raw: string
  /** Human-readable validity error when invalid; null otherwise. (v2: renders directly; structured {code,message} is a noted future seam for i18n.) */
  error: string | null
}

/**
 * Constructors so nobody hand-assembles the shape and it can't drift.
 *
 * @example
 * ParseResult.ok(1234.56, '$1,234.56')
 * ParseResult.fail('abc', 'Not a valid amount')
 */
export const ParseResult = {
  ok<T>(value: T, raw: string): ParseResult<T> {
    return { valid: true, value, raw, error: null }
  },
  fail<T = never>(raw: string, message: string): ParseResult<T> {
    return { valid: false, value: null, raw, error: message }
  },
}
