---
"diagnostics-webpack-plugin": patch
---

Hand Biome and oxlint every file at once when webpack is done building them, rather than in batches while it builds: each batch was a process of its own reading the configuration, and for Biome the project, again.
