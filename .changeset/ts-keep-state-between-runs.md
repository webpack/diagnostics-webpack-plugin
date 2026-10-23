---
"diagnostics-webpack-plugin": minor
---

Keep what the TypeScript check found between runs in the cache, as a `.tsbuildinfo` for each config file that the next run starts from, so that a second `webpack` run or a restarted dev server checks only what changed since. `cache: false` turns it off.
