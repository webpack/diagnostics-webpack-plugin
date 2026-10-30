---
"diagnostics-webpack-plugin": patch
---

Read the files kept under typed linting once per build rather than once per batch of files webpack hands over while it builds: every batch read the `tsconfig.json` and checked every file of the program again. Over 3,000 modules checked by both typed ESLint and the TypeScript check with `threads: false`, a build answered from what it kept took 13.3–13.7 s and now takes 11.9–12.4 s, and signing them took 1.9 s and now takes 0.3 s.
