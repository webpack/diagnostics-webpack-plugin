---
"diagnostics-webpack-plugin": patch
---

Lint every file again on a rebuild where a rule reads other files to answer for one. Typed linting — `parserOptions.project` or `projectService` — was reported from the previous run for any file that did not itself change, and ESLint's own cache held those results across runs, so a type that changed underneath a file went unreported until something else edited it.
