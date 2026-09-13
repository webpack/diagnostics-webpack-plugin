---
"diagnostics-webpack-plugin": patch
---

Cover `configType: "eslintrc"` over a worker pool, so that the ESLint 9 job in CI checks the way a worker loads ESLint as well as the way the build's own thread does.
