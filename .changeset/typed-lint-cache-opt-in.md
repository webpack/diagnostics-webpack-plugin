---
"diagnostics-webpack-plugin": minor
---

Keep ESLint's cache for typed linting when `cache: true` is written down, trading results in files whose imports changed for speed, as `eslint-webpack-plugin` does. Left unset, typed linting still runs without it.
