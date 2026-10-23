---
"diagnostics-webpack-plugin": patch
---

Lint every file again, rather than fail, where a project's TypeScript is the native TypeScript 7, which has no API to read what a file imports through: a check reading across files failed with `Cannot read properties of undefined (reading 'readFile')`.
