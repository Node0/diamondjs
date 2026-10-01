/**
 * JS source encoding for author text (#19).
 *
 * Template text and attribute values are DATA. The generator writes them into
 * three syntactic positions of the emitted module — a single-quoted string
 * literal, the static part of a template literal, a `//` hint comment — and
 * each position has exactly one encoder, here. The generator never assembles
 * quotes by hand. (Expressions are author CODE and are emitted as written.)
 */

/** U+2028 / U+2029 are invisible in a literal and end a line in a comment. */
function escapeLineSeparators(text: string): string {
  return text.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * A complete single-quoted JS string literal whose value is exactly `text`.
 * JSON.stringify owns the hard part (backslash, control characters, lone
 * surrogates); only the quote style differs.
 */
export function jsString(text: string): string {
  const body = JSON.stringify(text)
    .slice(1, -1)
    .replace(/\\.|'/g, (m) => (m === "'" ? "\\'" : m === '\\"' ? '"' : m))
  return `'${escapeLineSeparators(body)}'`
}

/**
 * The static part of a template literal (no surrounding backticks) whose
 * cooked value is exactly `text`. Backslash goes first: every later escape
 * adds backslashes of its own. A raw CR would be cooked to LF.
 */
export function jsTemplatePart(text: string): string {
  return escapeLineSeparators(
    text
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${')
      .replace(/\r/g, '\\r')
  )
}

/**
 * Text for a one-line `//` comment. A line terminator would end the comment
 * and leave the rest of the text as code, so each one — with the indentation
 * around it — folds to a single space.
 */
export function jsCommentText(text: string): string {
  return text.replace(/\s*[\n\r\u2028\u2029]\s*/g, ' ')
}
