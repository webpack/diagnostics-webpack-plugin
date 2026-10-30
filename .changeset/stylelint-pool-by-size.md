---
"diagnostics-webpack-plugin": patch
---

Lint stylesheets on webpack's thread unless a batch adds up to 2 MB, rather than over a pool of workers whatever its size: each worker loads Stylelint and its config again, which costs more than small stylesheets take to lint. Over 791 stylesheets on four cores, a cold build went from 12.4–13.7 s and 654–668 MB to 10.5–11.3 s and 506–533 MB. The README now says to set `transpileOnly: true` on `ts-loader` when moving from `fork-ts-checker-webpack-plugin`, which `ts-loader` otherwise turned on by itself.
