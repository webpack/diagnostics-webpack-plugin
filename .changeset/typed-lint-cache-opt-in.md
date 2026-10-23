---
"diagnostics-webpack-plugin": minor
---

Keep ESLint's cache for typed linting when `cache: true` is written down and no TypeScript is installed to follow imports with, trading results in files whose imports changed for speed, as `eslint-webpack-plugin` does.
