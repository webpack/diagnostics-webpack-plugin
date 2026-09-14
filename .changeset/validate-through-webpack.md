---
"diagnostics-webpack-plugin": major
---

Validate the options through webpack's own `compiler.validate` rather than `schema-utils`, which drops the last runtime dependency the plugin had for it. That API arrived in webpack 5.106, so the peer range is now `^5.106.0`.
