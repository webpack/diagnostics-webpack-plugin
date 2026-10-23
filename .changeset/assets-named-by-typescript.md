---
"diagnostics-webpack-plugin": patch
---

Tell an asset import from a script one by the extensions TypeScript itself reads, rather than by a list of asset kinds: an import of any other kind of file (`./data.toml`, say) no longer makes every rebuild lint every file again.
