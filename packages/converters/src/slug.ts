import { ParseResult } from '@diamondjs/runtime'

/**
 * Slug converter (v2.2.1 battery — promoted from the router reference
 * fixtures). The canonical converter for identifier-shaped route params
 * (`params: { corpusId: SlugConverter }`): lowercase kebab-case with a
 * leading letter — the same grammar route IDs use, applied to URL segments.
 *
 * @example  params: { corpusId: SlugConverter }
 */
export class SlugConverter {
  private static readonly SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

  /** slug → itself (already canonical; non-slugs render empty) */
  static format(value: string): string {
    return typeof value === 'string' && SlugConverter.SLUG_RE.test(value) ? value : ''
  }

  /** string → validated slug */
  static parse(raw: string): ParseResult<string> {
    const trimmed = raw.trim()
    if (trimmed === '') return ParseResult.fail(raw, 'Required')
    if (!SlugConverter.SLUG_RE.test(trimmed)) {
      return ParseResult.fail(
        raw,
        `"${raw}" is not a valid slug (lowercase kebab-case, leading letter)`
      )
    }
    return ParseResult.ok(trimmed, raw)
  }
}
