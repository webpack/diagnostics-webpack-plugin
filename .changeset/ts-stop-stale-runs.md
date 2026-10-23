---
"diagnostics-webpack-plugin": minor
---

Stop a TypeScript run that nothing will report any more. A check that `reportAs` keeps off the compilation runs after a watch rebuild. When it is on a worker of its own, it now stops a run of an older rebuild as soon as the next one starts, instead of finishing a check whose report would be dropped. Over 600 files, an edit made during a long check was reported after 2.3–2.6 s instead of 4.2–4.5 s, with about 2–3 CPU-seconds less work. Check adapters can stop such a run too, through an optional `cancel()` on their instance.
