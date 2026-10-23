---
"diagnostics-webpack-plugin": patch
---

Tell a module's file already listed for a check by a set rather than by searching the list, which made collecting files quadratic in the number of modules: 7 s of a 17 s build of 20,000 modules with three checks.
