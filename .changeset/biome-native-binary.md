---
"diagnostics-webpack-plugin": patch
---

Run Biome's binary directly rather than through its Node launcher, which started a Node process of its own on every run only to start the binary.
