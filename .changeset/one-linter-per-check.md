---
"diagnostics-webpack-plugin": patch
---

Load a check's linter for that check rather than once per module, so two Stylelint entries no longer lint under one another's options.
