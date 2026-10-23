---
"diagnostics-webpack-plugin": minor
---

Support TypeScript 7 in the TypeScript check. TypeScript 7 has no compiler API in JavaScript, so the check failed to load it at all. The check now runs the native compiler through the API TypeScript 7 ships (`typescript/unstable/async`), in a process of its own that stays open while webpack watches and is told which files webpack saw change. It prints diagnostics the way `tsc --pretty` does. `build`, a writing `mode`, and compiler options written in the plugin are reported as unsupported under TypeScript 7. Over 600 files, a one-shot build went from 3.5 s on TypeScript 6 to 1.4–1.5 s, and a watch rebuild from 1.0–2.5 s to 0.7–0.8 s.
