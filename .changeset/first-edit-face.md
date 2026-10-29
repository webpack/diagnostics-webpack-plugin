---
"diagnostics-webpack-plugin": patch
---

Leave the importers of a file be on its first edit in a watch too when what it shows them does not change, rather than only from its second edit on: what each file held is kept once the first build of the watch is over. In a project whose `tsconfig.json` sets `allowJs`, or a `rootDir` a file is outside of, what a TypeScript file shows its importers could not be read at all, so every edit linted every file importing it again; it is now read without the project's own compiler options. Over three hundred modules under typed linting, the first edit of a function's body took a rebuild from 2.0–2.2 s to 0.27–0.35 s.
