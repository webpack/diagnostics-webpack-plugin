---
"diagnostics-webpack-plugin": minor
---

Lint again every file a change reaches for any check whose results can turn on other files, not only ESLint's typed linting: oxlint with type-aware rules or the import plugin, and Biome, whose project rules read other files. The import graph moves into the plugin, and a new shared `readsAcrossFiles` option answers for any check, including one of your own.
