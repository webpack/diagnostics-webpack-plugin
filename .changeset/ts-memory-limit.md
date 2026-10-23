---
"diagnostics-webpack-plugin": minor
---

Add `memoryLimit` to the TypeScript check: the most memory, in MB, its worker may hold. Over it, the check reports so and starts the program from nothing on the next build rather than taking webpack's process with it.
