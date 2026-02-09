/**
 * @diamondjs/parcel-plugin
 *
 * Parcel 2 Transformer for DiamondJS Templates
 * Integrates the DiamondJS compiler with Parcel's build pipeline
 *
 * This transformer:
 * 1. Detects DiamondJS template files (HTML with binding syntax)
 * 2. Compiles templates to JavaScript with DiamondCore calls
 * 3. Generates source maps for debugging
 */

import { Transformer } from '@parcel/plugin'
import { isDiamondTemplate, compileTemplate } from './utils'

export default new Transformer({
  async transform({ asset }) {
    // Only process HTML files
    if (asset.type !== 'html') {
      return [asset]
    }

    const code = await asset.getCode()

    // Check if this is a DiamondJS template
    if (!isDiamondTemplate(code)) {
      // Not a Diamond template, pass through unchanged
      return [asset]
    }

    const filePath = asset.filePath

    // Compile the template (skip source maps for Phase 0)
    const { outputCode } = compileTemplate(code, filePath, false)

    // Set the transformed code
    asset.type = 'js'
    asset.setCode(outputCode)

    // Note: Source map support requires @parcel/source-map integration
    // This will be added in Phase 1

    return [asset]
  },
})

// Re-export utilities for external use
export { isDiamondTemplate, compileTemplate } from './utils'
