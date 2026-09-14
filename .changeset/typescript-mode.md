---
"diagnostics-webpack-plugin": minor
---

Add `mode` to the `typescript` check, which says what it writes as well as reports: `readonly` writes nothing, `write-tsbuildinfo` writes only `.tsbuildinfo`, `write-dts` writes declarations with it, and `write-references` writes everything the compiler emits. It defaults to `write-dts` under `build`, where a project reads the declarations of the one it references, and `readonly` otherwise — which is what the check did before.
