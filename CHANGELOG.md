# Changelog

## 1.0.0

### Major Changes

- `quiet` is gone: `reportAs` says what a check reports its results as, one value covering its errors and its warnings alike and an object setting them apart, so `quiet: true` is `reportAs: { warnings: false }`. (by [@alexander-akait](https://github.com/alexander-akait) in [#317](https://github.com/webpack/diagnostics-webpack-plugin/pull/317))

- `lintDirtyModulesOnly` is `lintOnStart`, inverted and defaulting to `true`. It says whether the first compilation lints every file it covers, and a build — which is nothing but a first compilation — now lints whatever it is set to, where `lintDirtyModulesOnly: true` used to leave a build silently unlinted. (by [@alexander-akait](https://github.com/alexander-akait) in [#320](https://github.com/webpack/diagnostics-webpack-plugin/pull/320))

- Renamed from `eslint-webpack-plugin` and merged with `stylelint-webpack-plugin`: one plugin runs every linter through the `checks` option, `new DiagnosticsPlugin({ checks: [{ use: "eslint" }, { use: "stylelint" }] })`. Errors are reported as webpack errors and warnings as webpack warnings, with `reportAs` deciding what each is reported as; `stylelint` must be 17 or later. See the migration guides in the README. (by [@alexander-akait](https://github.com/alexander-akait) in [#306](https://github.com/webpack/diagnostics-webpack-plugin/pull/306))

- Dropped Node.js 20, which is end-of-life. The minimum is now Node.js `>= 22.12.0`. (by [@alexander-akait](https://github.com/alexander-akait) in [#309](https://github.com/webpack/diagnostics-webpack-plugin/pull/309))

- Rewritten as ECMAScript modules. The package is now `"type": "module"` and declares an `exports` field, shipping an ESM build next to a CommonJS one, so `import DiagnosticsPlugin from "diagnostics-webpack-plugin"` and `require("diagnostics-webpack-plugin")` both keep working. (by [@alexander-akait](https://github.com/alexander-akait) in [#308](https://github.com/webpack/diagnostics-webpack-plugin/pull/308))

- `emitError`, `emitWarning`, `failOnError` and `failOnWarning` are one `reportAs` option taking `"error"`, `"warning"` or `false`: it says what a check reports its results as, and reporting one as a webpack error is what fails the build. Left unset each result keeps its own severity, `quiet` still drops the warnings, and the build is no longer aborted from inside the plugin. See the migration table in the README. (by [@alexander-akait](https://github.com/alexander-akait) in [#315](https://github.com/webpack/diagnostics-webpack-plugin/pull/315))

- Validate the options through webpack's own `compiler.validate` rather than `schema-utils`, which drops the last runtime dependency the plugin had for it. That API arrived in webpack 5.106, so the peer range is now `^5.106.0`. (by [@alexander-akait](https://github.com/alexander-akait) in [#345](https://github.com/webpack/diagnostics-webpack-plugin/pull/345))

### Minor Changes

- Add a `biome` check, which checks the files webpack builds with [Biome](https://biomejs.dev/) and reports what it finds at Biome's own severities. Run it with `{ use: "biome" }`, and `command: "check"` to add Biome's formatting diagnostics to the linter's; `@biomejs/biome >= 2` is an optional peer. (by [@alexander-akait](https://github.com/alexander-akait) in [#329](https://github.com/webpack/diagnostics-webpack-plugin/pull/329))

- Add `build` to the `typescript` check, which builds the projects the config file references the way `tsc -b` does — a `tsconfig.json` listing only `references` describes an empty program, so a solution reported nothing at all before. It writes each project's declarations, which is what the next project reads, and no JavaScript. (by [@alexander-akait](https://github.com/alexander-akait) in [#336](https://github.com/webpack/diagnostics-webpack-plugin/pull/336))

- Added ESLint bulk suppressions. `applySuppressions` and `suppressionsLocation` reach the `ESLint` class as they are on ESLint 10, and on ESLint 9.24 and later the plugin applies the suppressions itself, since ESLint only wires them into its CLI there. (by [@alexander-akait](https://github.com/alexander-akait) in [#311](https://github.com/webpack/diagnostics-webpack-plugin/pull/311))

- Naming `files` now means every file they match is checked, whether or not webpack built it, for every check rather than only the ones that walk the file system by themselves. A module nothing imports yet was invisible to the ESLint check before. Left unset, a check still reads what it always read. (by [@alexander-akait](https://github.com/alexander-akait) in [#325](https://github.com/webpack/diagnostics-webpack-plugin/pull/325))

- Add `ignoreDiagnostics` to the `typescript` check, the codes of the diagnostics not to report — a linter's rule can be turned off in its own configuration, a TypeScript diagnostic cannot. (by [@alexander-akait](https://github.com/alexander-akait) in [#335](https://github.com/webpack/diagnostics-webpack-plugin/pull/335))

- `ignoreDiagnostics` is a shared option every check reads, and takes a rule or code as a string, a match of a file, code and severity together, a list of any of them, or a function over each thing a check found. A TypeScript code as a number, which is all it took before, still means what it did. (by [@alexander-akait](https://github.com/alexander-akait) in [#341](https://github.com/webpack/diagnostics-webpack-plugin/pull/341))

- Add an `oxlint` check, which lints the files webpack builds with [oxlint](https://oxc.rs/docs/guide/usage/linter.html) and reports what it finds at oxlint's own severities. Run it with `{ use: "oxlint" }`; `oxlint >= 1` is an optional peer. (by [@alexander-akait](https://github.com/alexander-akait) in [#328](https://github.com/webpack/diagnostics-webpack-plugin/pull/328))

- Add `"log"` to `reportAs`, which writes a check's results to webpack's log rather than onto the compilation, so they reach the terminal without the build carrying an error or a warning. (by [@alexander-akait](https://github.com/alexander-akait) in [#331](https://github.com/webpack/diagnostics-webpack-plugin/pull/331))

- `threads` is a shared option defaulting to `"auto"`, so every check spreads its work rather than holding the thread webpack builds on: a check that threads its own work is asked to, and one that cannot is run in a pool the plugin owns. Over three hundred modules that takes about a fifth off the build. It was Stylelint's alone and off by default; a check added later now gets it for nothing. (by [@alexander-akait](https://github.com/alexander-akait) in [#324](https://github.com/webpack/diagnostics-webpack-plugin/pull/324))

- Run the `typescript` check on a worker thread, so webpack builds while it type checks. A program is read whole rather than a file at a time, so `threads` buys it webpack's own thread back rather than a share of the work; `threads: false`, and a `formatter` written as a function, keep it where webpack is. (by [@alexander-akait](https://github.com/alexander-akait) in [#343](https://github.com/webpack/diagnostics-webpack-plugin/pull/343))

- Add a `typescript` check, which type checks the program a `tsconfig.json` describes and reports its diagnostics as webpack errors and warnings. Run it with `{ use: "typescript" }`; `typescript >= 5` is an optional peer. (by [@alexander-akait](https://github.com/alexander-akait) in [#327](https://github.com/webpack/diagnostics-webpack-plugin/pull/327))

- Add `diagnosticOptions` to the `typescript` check, which says whether to report each kind of diagnostic — syntactic, semantic, declaration and global. Turning one off asks TypeScript for less rather than dropping what it answered. (by [@alexander-akait](https://github.com/alexander-akait) in [#340](https://github.com/webpack/diagnostics-webpack-plugin/pull/340))

- Add `mode` to the `typescript` check, which says what it writes as well as reports: `readonly` writes nothing, `write-tsbuildinfo` writes only `.tsbuildinfo`, `write-dts` writes declarations with it, and `write-references` writes everything the compiler emits. It defaults to `write-dts` under `build`, where a project reads the declarations of the one it references, and `readonly` otherwise — which is what the check did before. (by [@alexander-akait](https://github.com/alexander-akait) in [#348](https://github.com/webpack/diagnostics-webpack-plugin/pull/348))

- Option validation now runs from webpack's `compiler.hooks.validate`, so a mistake is reported where webpack validates the rest of the configuration and `validate: false` turns it off. Where webpack predates the hook, in 5.106, the plugin validates as it did before. (by [@alexander-akait](https://github.com/alexander-akait) in [#313](https://github.com/webpack/diagnostics-webpack-plugin/pull/313))

### Patch Changes

- Run a check the compilation carries nothing of — one whose `reportAs` leaves out both its errors and its warnings, writing no `outputReport` — after a watch rebuild rather than during it, so that the rebuild is over before the check starts and what it finds is printed to the terminal when it lands. (by [@alexander-akait](https://github.com/alexander-akait) in [#333](https://github.com/webpack/diagnostics-webpack-plugin/pull/333))

- Document `checks` itself, list every option in one table, and add a migration from `fork-ts-checker-webpack-plugin`. (by [@alexander-akait](https://github.com/alexander-akait) in [#339](https://github.com/webpack/diagnostics-webpack-plugin/pull/339))

- Drop the dependencies nothing uses: `@types/eslint`, which ESLint has shipped itself since 9 and which nothing reaches from the package entry, along with `del`, `@types/micromatch` and commitlint. (by [@alexander-akait](https://github.com/alexander-akait) in [#346](https://github.com/webpack/diagnostics-webpack-plugin/pull/346))

- Cover `configType: "eslintrc"` over a worker pool, so that the ESLint 9 job in CI checks the way a worker loads ESLint as well as the way the build's own thread does. (by [@alexander-akait](https://github.com/alexander-akait) in [#338](https://github.com/webpack/diagnostics-webpack-plugin/pull/338))

- Cover a `files` or `exclude` folder that the build has still to write. (by [@alexander-akait](https://github.com/alexander-akait) in [#352](https://github.com/webpack/diagnostics-webpack-plugin/pull/352))

- Stop watching for a file the TypeScript check has since been able to read. (by [@alexander-akait](https://github.com/alexander-akait) in [#354](https://github.com/webpack/diagnostics-webpack-plugin/pull/354))

- Lint only the files webpack rebuilt, reporting the rest from the previous compilation, and start linting while the module graph is still being built. (by [@alexander-akait](https://github.com/alexander-akait) in [#319](https://github.com/webpack/diagnostics-webpack-plugin/pull/319))

- Walk the file system for a check's files without blocking the thread webpack builds on, and read the tree once where two compilers want the same walk. (by [@alexander-akait](https://github.com/alexander-akait) in [#357](https://github.com/webpack/diagnostics-webpack-plugin/pull/357))

- Load a check's linter for that check rather than once per module, so two Stylelint entries no longer lint under one another's options. (by [@alexander-akait](https://github.com/alexander-akait) in [#356](https://github.com/webpack/diagnostics-webpack-plugin/pull/356))

- Lint every file again on a rebuild where a rule reads other files to answer for one. Typed linting — `parserOptions.project` or `projectService` — was reported from the previous run for any file that did not itself change, and ESLint's own cache held those results across runs, so a type that changed underneath a file went unreported until something else edited it. (by [@alexander-akait](https://github.com/alexander-akait) in [#347](https://github.com/webpack/diagnostics-webpack-plugin/pull/347))

- Replace `globby`, `micromatch` and `normalize-path` with `tinyglobby` and `picomatch`, and compile the file matchers once per check rather than on every module. (by [@alexander-akait](https://github.com/alexander-akait) in [#316](https://github.com/webpack/diagnostics-webpack-plugin/pull/316))

- Report a change made to a `build` project while the last build was running. `tsc -b` reads how old an input is next to the outputs of the last build, so such an edit looked up to date and was reported as clean until something else changed; what the check compares against now is the moment the last build started reading. (by [@alexander-akait](https://github.com/alexander-akait) in [#344](https://github.com/webpack/diagnostics-webpack-plugin/pull/344))

- Exclude every module a `resourceQueryExclude` regexp matches, not every other one. (by [@alexander-akait](https://github.com/alexander-akait) in [#353](https://github.com/webpack/diagnostics-webpack-plugin/pull/353))

- Keep the programs a built solution is made of between rebuilds, so `build` rebuilds a project on the one before it rather than parsing and checking it over again. Over a two-project, 302-file solution a rebuild after one edit falls from 468 ms to 149 ms, with no more memory held. (by [@alexander-akait](https://github.com/alexander-akait) in [#342](https://github.com/webpack/diagnostics-webpack-plugin/pull/342))

- Keep the `typescript` check's program between rebuilds, so that a watch rebuild type checks what the change reaches rather than the whole project again. (by [@alexander-akait](https://github.com/alexander-akait) in [#332](https://github.com/webpack/diagnostics-webpack-plugin/pull/332))

- Drive a tool once where two compilers run the same check over the same files: the second joins the run the first is making, and both compilations report what it finds and watch what it read. Two compilers type checking three hundred files build one program rather than two. (by [@alexander-akait](https://github.com/alexander-akait) in [#337](https://github.com/webpack/diagnostics-webpack-plugin/pull/337))

- Fall back to Stylelint's default formatter for a name it has none under. (by [@alexander-akait](https://github.com/alexander-akait) in [#355](https://github.com/webpack/diagnostics-webpack-plugin/pull/355))

- Tell a stylelint formatter the rule metadata of what it reports. (by [@alexander-akait](https://github.com/alexander-akait) in [#350](https://github.com/webpack/diagnostics-webpack-plugin/pull/350))

- Tell two entries of the same check apart, so neither reports the other's results. (by [@alexander-akait](https://github.com/alexander-akait) in [#351](https://github.com/webpack/diagnostics-webpack-plugin/pull/351))

- Watch the files a check reads rather than only the ones webpack builds, so that a change to a file outside the module graph — one `stylelint` globs, or one a `tsconfig.json` lists — rebuilds, and a file added or removed there is picked up. (by [@alexander-akait](https://github.com/alexander-akait) in [#330](https://github.com/webpack/diagnostics-webpack-plugin/pull/330))

- Watch the folders a check takes its files from, and the paths an import resolved to nothing through, so that a file you add is checked without anything else having to change. A folder is watched only when the whole of it can be: one holding `output.path` or what the check excludes is left alone. (by [@alexander-akait](https://github.com/alexander-akait) in [#334](https://github.com/webpack/diagnostics-webpack-plugin/pull/334))
