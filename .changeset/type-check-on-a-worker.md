---
"diagnostics-webpack-plugin": minor
---

Run the `typescript` check on a worker thread, so webpack builds while it type checks. A program is read whole rather than a file at a time, so `threads` buys it webpack's own thread back rather than a share of the work; `threads: false`, and a `formatter` written as a function, keep it where webpack is.
