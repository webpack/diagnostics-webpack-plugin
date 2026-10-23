---
"diagnostics-webpack-plugin": patch
---

Hand ESLint every file at once when it threads the lint itself, rather than in batches while webpack builds: each batch started ESLint's workers and loaded the configuration and its plugins again. A new adapter hook, `lintsOnce(options)`, says so for any check.
