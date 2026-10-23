---
"diagnostics-webpack-plugin": patch
---

Document what settings outside the plugin make it faster: `skipLibCheck`, ESLint's `cacheStrategy: "content"` where CI restores the cache, and `NODE_COMPILE_CACHE`.
