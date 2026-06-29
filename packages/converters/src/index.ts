/**
 * @diamondjs/converters
 *
 * Opt-in "batteries" — format/parse converter classes used with the pipe `|`
 * (DDR §5.8). Nothing in the framework core imports these; they are added per
 * project (the import graph is the registry, §5.5) and tree-shake cleanly.
 *
 * @example
 * import { CurrencyConverter } from '@diamondjs/converters'
 * // template: value.two-way="amount | CurrencyConverter('USD')"
 */
export { CurrencyConverter } from './currency'
export { DateConverter } from './date'
export { PhoneConverter } from './phone'
