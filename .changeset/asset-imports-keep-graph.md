---
"diagnostics-webpack-plugin": patch
---

Keep linting again only what a change reaches in a project importing stylesheets, images or other assets: such an import, which TypeScript resolves to nothing, counted as an import yet to resolve and made every rebuild lint every file again.
