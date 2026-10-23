---
"diagnostics-webpack-plugin": minor
---

Share the TypeScript check's worker, and the program it holds, between the compilers of a `MultiCompiler` whose TypeScript checks are configured alike. Before, each compiler built and kept its own program. Over 600 files, two compilers building one after the other went through a watch with one rebuild in 5.6–5.8 s, 9.8–10.4 CPU-seconds and 467–483 MB, against 9.7–10.3 s, 18.7–20.0 CPU-seconds and 803–853 MB. A run one compiler stops no longer stops another's on the shared worker.
