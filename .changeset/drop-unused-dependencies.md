---
"diagnostics-webpack-plugin": patch
---

Drop the dependencies nothing uses: `@types/eslint`, which ESLint has shipped itself since 9 and which nothing reaches from the package entry, along with `del`, `@types/micromatch` and commitlint.
