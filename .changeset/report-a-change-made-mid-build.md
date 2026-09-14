---
"diagnostics-webpack-plugin": patch
---

Report a change made to a `build` project while the last build was running. `tsc -b` reads how old an input is next to the outputs of the last build, so such an edit looked up to date and was reported as clean until something else changed; what the check compares against now is the moment the last build started reading.
