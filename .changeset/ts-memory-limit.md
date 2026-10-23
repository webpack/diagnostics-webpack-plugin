---
"diagnostics-webpack-plugin": minor
---

Add `memoryLimit` to the TypeScript check: the most memory, in MB, its worker's JavaScript heap may hold. Over it, the check reports so and starts the program from nothing on the next build. Memory outside the heap is not counted, and a `--max-old-space-size` given to Node takes its place.
