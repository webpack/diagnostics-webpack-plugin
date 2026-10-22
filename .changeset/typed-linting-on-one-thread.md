---
"diagnostics-webpack-plugin": patch
---

Lint a typed ESLint configuration on webpack's thread rather than over `threads`, where every worker built the TypeScript program again from cold on every rebuild.
