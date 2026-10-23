---
"diagnostics-webpack-plugin": patch
---

Resolve the imports of every file in a pass of the import graph through one module resolution cache per set of compiler options, rather than looking up the same package or shared module again for every file importing it.
