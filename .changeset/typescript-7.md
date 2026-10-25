---
"diagnostics-webpack-plugin": minor
---

Support TypeScript 7 in the TypeScript check, from 7.1. TypeScript 7 has no compiler API in JavaScript, so the check failed to load it at all. The check now runs the native compiler through the API TypeScript ships, `typescript/async`, in a process of its own that stays open while webpack watches and is told which files webpack saw change, and prints diagnostics with TypeScript's own formatter. `build`, a writing `mode`, and compiler options written in the plugin are reported as unsupported under TypeScript 7. TypeScript 7.0, which shipped that API only as an unstable preview, is reported as having no API to check with. Over 600 files, a one-shot build took 1.2–1.3 s on TypeScript 7.1, against 3.8 s on TypeScript 6 without its saved state.
