# DiamondJS specifications

One folder per specification version. A spec's version matches the published DiamondJS release it describes. The spec is authoritative over the code: where the two disagree, the code is nonconforming, and the spec's §16 lists every known divergence.

| Folder | Specification | Also holds |
|---|---|---|
| [`v2.3.0/`](v2.3.0/) | Architecture Specification v2.3.0 — **current published release**; §4.5 (component composition) proposed for v2.3.1 | Lifecycle Contract design record and work order |
| [`v2.2.4/`](v2.2.4/) | Architecture Specification v2.2.4 — previous published release | — |
| [`v2.2.0/`](v2.2.0/) | v2.2 Router Specification | v2.2 Implementation Work Order; Amendment A3 (governs 2.1.1 and 2.2.0) |
| [`v2.1.0/`](v2.1.0/) | Architecture Specification v2.1 | v2.0 Design Decision Record; Amendment A2; deferred work for v2.1 |
| [`v1.5.1/`](v1.5.1/) | Architecture Specification v1.5.1 | v1.3 specification; v1.3 → v1.5.1 upgrade instructions |

Each newer specification supersedes the older ones as the reference; the older documents stay as the rationale archive. `diff v2.2.4/… v2.3.0/…` shows exactly what a release changes. The chronological record of how each release was built is in [`impl_docs/`](../../impl_docs/), which holds logs and working notes only.
