---
"diagnostics-webpack-plugin": minor
---

Add `build` to the `typescript` check, which builds the projects the config file references the way `tsc -b` does — a `tsconfig.json` listing only `references` describes an empty program, so a solution reported nothing at all before. It writes each project's declarations, which is what the next project reads, and no JavaScript.
