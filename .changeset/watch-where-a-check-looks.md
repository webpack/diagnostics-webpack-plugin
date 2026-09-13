---
"diagnostics-webpack-plugin": patch
---

Watch the folders a check takes its files from, and the paths an import resolved to nothing through, so that a file you add is checked without anything else having to change. A folder is watched only when the whole of it can be: one holding `output.path` or what the check excludes is left alone.
