Summary
This PR hardens DiamondJS against DOM XSS by making unsafe DOM sink bindings opt-in instead of default.

Before this change, templates like innerhtml.bind="userContent" compiled to raw el.innerHTML = value writes with no guardrails. If userContent was user-controlled, this enabled direct script injection.

After this change:

Unsafe sinks are blocked by default at compile time.
Runtime also blocks them as a defense-in-depth backstop.
Developers can still opt in explicitly via .unsafe-bind / DiamondCore.bindUnsafe() for trusted, sanitized content.
Root Cause
innerhtml is mapped to innerHTML in the parser, and normal binding paths generate/execute unrestricted dynamic property assignment:

parser property mapping (innerhtml → innerHTML)
compiler generation of standard DiamondCore.bind(...)
runtime el[property] = value
This combination allowed high-risk sinks (innerHTML, outerHTML, srcdoc) to be used through ordinary binding syntax.

Changes
Compiler (@diamondjs/compiler)
Added new binding command type: unsafe-bind.
Added compile-time security validation in DiamondCompiler.compile():
Blocks bindings to innerHTML, outerHTML, and srcdoc unless the binding uses .unsafe-bind.
Throws CompileError with source location and remediation guidance.
Code generator now emits DiamondCore.bindUnsafe(...) for .unsafe-bind.
Runtime (@diamondjs/runtime)
Added runtime unsafe sink guard to DiamondCore.bind(...).
Added explicit unsafe API: DiamondCore.bindUnsafe(...).
Shared implementation path ensures consistent behavior and message quality.
Parcel Transformer (@diamondjs/parcel-transformer-diamond)
Updated template detection regex to recognize .unsafe-bind so opt-in bindings are compiled correctly.
Docs
README: documented .unsafe-bind and default sink-blocking behavior.
FAQ: added explicit XSS prevention/opt-in guidance.
Tests
Added/updated tests across packages:

Compiler:
blocks innerhtml.bind by default
allows innerhtml.unsafe-bind
parses unsafe-bind
generates DiamondCore.bindUnsafe(...)
Runtime:
blocks unsafe sinks in DiamondCore.bind
allows explicit DiamondCore.bindUnsafe
Parcel plugin:
recognizes .unsafe-bind in isDiamondTemplate
Breaking Change
Templates that previously bound unsafe sinks with normal binding commands now fail compilation.

Migration
Use explicit opt-in for trusted/sanitized content:

<div innerhtml.unsafe-bind="trustedHtml"></div>
or explicit runtime API:

DiamondCore.bindUnsafe(el, 'innerHTML', () => trustedSanitizedHtml)
Validation
Executed on this branch:

npm run build --workspaces --if-present
npm test --workspaces --if-present
npm run lint --workspaces --if-present
npm run check-loc
All passed (lint has existing non-fatal warnings in long test files).