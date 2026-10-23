---
"diagnostics-webpack-plugin": patch
---

Keep the results of typed linting between runs, against everything each file imports rather than in ESLint's cache, so that a second `webpack` run lints only the files a change reaches instead of all of them again.
