---
"diagnostics-webpack-plugin": minor
---

Naming `files` now means every file they match is checked, whether or not webpack built it, for every check rather than only the ones that walk the file system by themselves. A module nothing imports yet was invisible to the ESLint check before. Left unset, a check still reads what it always read.
