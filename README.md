<div align="center">
  <a href="https://github.com/eslint/eslint"><img width="160" height="160" src="https://cdn.worldvectorlogo.com/logos/eslint.svg"></a>
  <a href="https://github.com/stylelint/stylelint"><img width="160" height="160" src="https://cdn.worldvectorlogo.com/logos/stylelint.svg"></a>
  <a href="https://github.com/webpack/webpack"><img width="160" height="160" src="https://webpack.js.org/assets/icon-square-big.svg"></a>
</div>

[![npm][npm]][npm-url]
[![node][node]][node-url]
[![tests][tests]][tests-url]
[![coverage][cover]][cover-url]
[![discussion][discussion]][discussion-url]
[![size][size]][size-url]

# diagnostics-webpack-plugin

> This plugin only supports webpack 5 and Node.js `>= 22.12.0`.

This plugin runs linters, type checkers and other diagnostic tools over your sources during the webpack build and reports what they find as webpack errors and warnings.

It replaces `eslint-webpack-plugin` and `stylelint-webpack-plugin`: one plugin, one place to configure how problems are reported, and one pass over your project. Today it runs [`ESLint`](https://eslint.org/), [`Stylelint`](https://stylelint.io/), [`oxlint`](https://oxc.rs/docs/guide/usage/linter.html), [`Biome`](https://biomejs.dev/) and [`TypeScript`](https://www.typescriptlang.org/); more linters and diagnostic tools are meant to be added the same way.

## Getting Started

To begin, you'll need to install `diagnostics-webpack-plugin`:

```console
npm install diagnostics-webpack-plugin --save-dev
```

or

```console
yarn add -D diagnostics-webpack-plugin
```

or

```console
pnpm add -D diagnostics-webpack-plugin
```

> [!NOTE]
>
> Install the tools you want to run as well — the plugin only requires the ones you enable. It supports `eslint >= 9`, `stylelint >= 17`, `oxlint >= 1`, `@biomejs/biome >= 2` and `typescript >= 5`:

```console
npm install eslint stylelint oxlint @biomejs/biome typescript --save-dev
```

Then add the plugin to your webpack configuration and enable a check for each language you want inspected:

```js
import DiagnosticsPlugin from "diagnostics-webpack-plugin";

export default {
  // ...
  plugins: [
    new DiagnosticsPlugin({
      checks: [
        { use: "eslint", extensions: ["js", "mjs"] },
        { use: "stylelint", extensions: ["css", "scss"] },
      ],
    }),
  ],
  // ...
};
```

The package ships an ECMAScript build next to a CommonJS one, so a CommonJS configuration works just as well:

```js
const DiagnosticsPlugin = require("diagnostics-webpack-plugin");
```

## Options

The plugin options have three layers:

| Layer                     | Where it goes                    | What it covers                                                                         |
| :------------------------ | :------------------------------- | :------------------------------------------------------------------------------------- |
| [Plugin](#plugin-options) | Top level only                   | How the plugin schedules its work, for every check at once.                            |
| [Shared](#shared-options) | Top level or in a `checks` entry | Which files are linted and how problems are reported. An entry overrides what it sets. |
| Check                     | In a `checks` entry              | Options only that tool understands, plus everything its own Node.js API accepts.       |

The options are checked against their schema from webpack's own [`validate`](https://webpack.js.org/configuration/other-options/#validate) hook, so a mistake is reported when webpack validates the rest of your configuration, and `validate: false` turns the check off along with webpack's.

Every check to run is an entry in `checks`, named by its `use`. The list may name the same tool more than once, so one instance can inspect two file sets under different configurations.

```js
new DiagnosticsPlugin({
  // Plugin options
  context: "src",
  // Shared options, every check uses them unless it says otherwise
  reportAs: "warning", // report every check's results as warnings
  exclude: ["node_modules", "vendor"],
  // The checks to run, each with the options only it understands
  checks: [
    { use: "eslint", extensions: ["js", "ts"], fix: true },
    { use: "stylelint", extensions: ["css", "scss"], threads: true },
  ],
});
```

### Plugin options

#### `context`

- Type:

```ts
type context = string;
```

- Default: `compiler.context`

Base directory for linting. Every relative `files` and `exclude` pattern is resolved against it.

#### `lintOnStart`

- Type:

```ts
type lintOnStart = boolean;
```

- Default: `true`

Whether the first compilation lints every file it covers. Leave it alone and a
build lints everything while a watch run lints everything once and then only
what webpack rebuilds.

Set it to `false` to start a watch run quiet: nothing is linted until you touch
a file, and only the modules webpack rebuilds are reported. A build is nothing
but a first compilation, so it lints either way — the option cannot silence one.

#### Running the checks in one mode only

There is no option for this and none is needed: `plugins` ignores a falsy entry,
so `&&` decides whether the plugin is there at all. A configuration function is
handed the `--env` values, and `webpack-cli` states the mode in them:

| Value                             | Set by                                |
| --------------------------------- | ------------------------------------- |
| `WEBPACK_SERVE`                   | `webpack serve`                       |
| `WEBPACK_WATCH`                   | `webpack watch` and `webpack --watch` |
| `WEBPACK_BUILD`, `WEBPACK_BUNDLE` | `webpack`, a build that runs once     |

```js
import DiagnosticsPlugin from "diagnostics-webpack-plugin";
import { defineConfig } from "webpack";

export default defineConfig((env) => ({
  plugins: [
    // Both values are read because each command sets only its own: `serve` sets
    // `WEBPACK_SERVE` and `--watch` sets `WEBPACK_WATCH`, so asking for one of
    // them misses the other way of watching. Read `WEBPACK_BUILD` instead to
    // check a build that runs once and leave a watch run alone.
    (env.WEBPACK_SERVE || env.WEBPACK_WATCH) &&
      new DiagnosticsPlugin({ checks: ["eslint", "stylelint"] }),
  ],
}));
```

This is worth doing when something else already lints the same files — a CI job
running `eslint .`, or an editor — and the release build need not pay for it
twice.

### Shared options

These can be set at the top level, where they apply to every check, or inside one check, where they apply to that check alone.

#### `cache`

- Type:

```ts
type cache = boolean;
```

- Default: `true`

The cache is enabled by default to decrease execution time.

#### `cacheLocation`

- Type:

```ts
type cacheLocation = string;
```

- Default: `node_modules/.cache/diagnostics-webpack-plugin/.<tool>cache`

Specify the path to the cache location. Can be a file or a directory.

#### `files`

- Type:

```ts
type files = string | string[];
```

- Default: `options.context`

Specify directories, files, or globs. Must be relative to `options.context`.
Directories are traversed recursively looking for files matching `options.extensions`.
File and glob patterns ignore `options.extensions`.

#### `extensions`

- Type:

```ts
type extensions = string | string[];
```

- Default: `'js'` for ESLint, `['css', 'scss', 'sass']` for Stylelint

Specify file extensions that should be checked.

#### `exclude`

- Type:

```ts
type exclude = string | string[];
```

- Default: `'node_modules'`, plus `output.path` for Stylelint

Specify the files/directories to exclude. Must be relative to `options.context`.

#### `threads`

- Type:

```ts
type threads = boolean | number | "auto";
```

- Default: `"auto"`

How many threads a check spreads its work over. `"auto"` takes one fewer than the
machine has, leaving webpack the thread it builds on; a number asks for that
many; `false`, `0` or `1` keeps the work on webpack's own thread.

A check that threads its own work is asked to, and one that cannot is run in a
pool of workers — so the option means the same thing whatever is being checked,
and a check added later gets it for nothing. ESLint threads its own work from
9.34.0 under flat config; Stylelint threads none of its own, so it is pooled.

Prefer `"auto"` over a count. A check sizes `"auto"` against the machine, where a
fixed number can end up competing with webpack for the same cores: over three
hundred modules on four of them, `"auto"` took about a fifth off the build while
asking for three was no better than asking for none. A count above what the
machine has is held to it, since asking for sixteen threads on four cores took
twice as long as asking for none — the ceiling cannot save a number written
against the tool itself, such as ESLint's `concurrency`, which is passed through
as written.

Anything written against the tool itself wins — ESLint's own `concurrency`, say —
and a check configured with a function, such as a formatter written in the
configuration, is run on webpack's thread, because a function cannot be handed
to a worker.

#### `resourceQueryExclude`

- Type:

```ts
type resourceQueryExclude = RegExp | RegExp[];
```

- Default: `[]`

Specify the resource query to exclude. Only affects checks that read the module graph, such as ESLint.

#### `fix`

- Type:

```ts
type fix = boolean;
```

- Default: `false`

Will enable the autofix feature of the tool.

**Be careful: this option will modify source files.**

#### `formatter`

- Type:

```ts
type formatter = string | ((results: LintResult[]) => string);
```

- Default: the tool's own default formatter

Accepts the name of a formatter the tool ships, or a function that receives its results and returns the output as a string.

See the [ESLint formatters](https://eslint.org/docs/user-guide/formatters/) and the [Stylelint `formatter` option](https://stylelint.io/user-guide/usage/options#formatter).

### Errors and warnings

Every check reports its errors as webpack errors and its warnings as webpack warnings, which is what fails the build. `reportAs` overrides that.

#### `reportAs`

- Type:

```ts
type reportAs = Severity | { errors?: Severity; warnings?: Severity };
type Severity = "error" | "warning" | "log" | false;
```

- Default: unset — each result stays at the severity the check gave it

What a check reports its results as. One value covers its errors and its warnings alike; an object sets them apart, and a severity the object leaves out keeps its own:

| Value                   | Effect                                                     |
| :---------------------- | :--------------------------------------------------------- |
| unset                   | Errors fail the build, warnings do not.                    |
| `"error"`               | Everything fails the build, warnings included.             |
| `"warning"`             | Nothing fails the build; errors are reported as warnings.  |
| `"log"`                 | The terminal alone, through webpack's log.                 |
| `false`                 | Nothing is reported. An `outputReport` is still written.   |
| `{ warnings: false }`   | The errors alone, still failing the build.                 |
| `{ warnings: "error" }` | Warnings fail the build too, and errors keep failing it.   |
| `{ errors: "warning" }` | Errors stop failing the build, and warnings stay warnings. |

```js
new DiagnosticsPlugin({
  reportAs: { warnings: false }, // the errors alone
  checks: [{ use: "eslint" }],
});
```

`"log"` is for a check nobody should be stopped by yet. Its results reach
webpack's log — the terminal, and `stats.logging` — rather than
`compilation.errors` or `compilation.warnings`, so the build carries neither,
`stats.hasWarnings()` stays false and a dev server overlays nothing. An
`outputReport` is written either way.

```js
new DiagnosticsPlugin({
  // the whole project is linted, and only the new check is advisory
  checks: [{ use: "eslint" }, { use: "typescript", reportAs: "log" }],
});
```

#### `outputReport`

- Type:

```ts
type outputReport =
  | boolean
  | {
      filePath?: string | undefined;
      formatter?: (string | ((results: LintResult[]) => string)) | undefined;
    };
```

- Default: `false`

Write the results to a file, for example a checkstyle xml file for use for reporting on Jenkins CI.

- `filePath`: path to the output report file, relative to `output.path` unless absolute.
- `formatter`: a different `formatter` for the output file; the default/configured formatter is used when none is passed in.

Set at the top level, every check appends its report to the same file. Set it inside a `checks` entry to give that check a file of its own.

```js
new DiagnosticsPlugin({
  checks: [
    {
      use: "eslint",
      outputReport: { filePath: "eslint.json", formatter: "json" },
    },
    {
      use: "stylelint",
      outputReport: { filePath: "stylelint.json", formatter: "json" },
    },
  ],
});
```

## ESLint

Run with `{ use: "eslint" }`. It lints the files webpack builds, so only the modules that end up in the bundle are checked.

Alongside the shared options you can pass any [ESLint Node.js API option](https://eslint.org/docs/latest/integrate/nodejs-api#-new-eslintoptions) — they are handed to the `ESLint` class as they are.

[`threads`](#threads) reaches ESLint as its own `concurrency` from 9.34.0 under flat config, and an older ESLint or an `eslintrc` one is pooled instead. Write `concurrency` yourself and that is what ESLint is given, whatever `threads` says. Note that webpack spells this idea `parallelism`, and uses the word concurrency for something else again — bounded work on one thread.

A rebuild lints only the files webpack rebuilt and reports the rest from the previous run, so [`lintOnStart`](#lintonstart) is only worth setting to start a watch run quiet.

### `configType`

- Type:

```ts
type configType = "flat" | "eslintrc";
```

- Default: `flat`

Specify the type of configuration to use with ESLint.

- `flat` is the current standard configuration format.
- `eslintrc` is the legacy configuration format and has been officially deprecated.

The new configuration format is explained in its [own documentation](https://eslint.org/docs/latest/use/configure/configuration-files).

### `eslintPath`

- Type:

```ts
type eslintPath = string;
```

- Default: `eslint`

Path to the `eslint` instance that will be used for linting.

If the `eslintPath` is a folder like the official ESLint, or you specify a `formatter` option, you don't have to install `eslint`.

### Suppressions

[Bulk suppressions](https://eslint.org/docs/latest/use/suppressions) are supported: enable ESLint's own `applySuppressions`, and point `suppressionsLocation` at the file if it is not the default `eslint-suppressions.json`.

```js
new DiagnosticsPlugin({
  checks: [{ use: "eslint", applySuppressions: true }],
});
```

> [!IMPORTANT]
>
> ESLint resolves the suppressions file, and every path recorded inside it, against its own `cwd` — not against the plugin's [`context`](#context). Where the two differ, pass `cwd` to the check as well:
>
> ```js
> new DiagnosticsPlugin({
>   context: "src",
>   checks: [
>     { use: "eslint", applySuppressions: true, cwd: import.meta.dirname },
>   ],
> });
> ```

Suppressions need ESLint 9.24 or later. ESLint 10 takes both options itself; below that they reach its CLI alone, so the plugin applies the suppressions after linting instead — the same file, the same paths, the same result.

## Stylelint

Run with `{ use: "stylelint" }`, and requires `stylelint >= 17`. It lints every file matching `files` and `extensions` on disk, whether or not webpack imported it, so a stylesheet nothing imports yet is still checked.

Alongside the shared options you can pass any [Stylelint option](https://stylelint.io/user-guide/usage/node-api#options) — they are handed to `stylelint.lint()` as they are.

### `stylelintPath`

- Type:

```ts
type stylelintPath = string;
```

- Default: `stylelint`

Path to the `stylelint` instance that will be used for linting.

## oxlint

Run with `{ use: "oxlint" }`, and requires `oxlint >= 1`. It lints the files
webpack builds, as the ESLint check does, and reads whatever `.oxlintrc.json`
oxlint finds for itself.

```js
new DiagnosticsPlugin({ checks: ["eslint", "oxlint"] });
```

oxlint is a binary behind a Node entry rather than a library, so this check runs
it and reads the JSON it answers with. Two things follow. Its severities are
oxlint's own — a rule set to `"error"` in `.oxlintrc.json` is reported as a
webpack error and one set to `"warn"` as a warning, and [`reportAs`](#reportas)
moves them from there as it does for every check. And the options this check does
not name are not guessed at: write them as [`args`](#args), the flags oxlint
itself documents.

### `oxlintPath`

- Type:

```ts
type oxlintPath = string;
```

- Default: `oxlint`

Path to the `oxlint` instance that will be used for linting.

### `configFile`

- Type:

```ts
type configFile = string;
```

- Default: unset, leaving oxlint to find its own

Path to the `.oxlintrc.json` to lint with.

### `args`

- Type:

```ts
type args = string[];
```

- Default: `[]`

Arguments passed to oxlint as they are, for the flags this check does not name —
`["--deny", "correctness"]`, say. Not `--format`: the check asks for JSON and
formats the results itself, and oxlint declines being asked twice.

## Biome

Run with `{ use: "biome" }`, and requires `@biomejs/biome >= 2`. It checks the
files webpack builds and reads whatever `biome.json` Biome finds for itself,
reporting at Biome's own severities.

```js
new DiagnosticsPlugin({ checks: ["biome"] });
```

Like the oxlint check this runs a binary and reads the JSON it answers with,
which Biome calls an experimental reporter — a release of its own may move the
shape, and it is the only reporter carrying the severities this check needs.

### `biomePath`

- Type:

```ts
type biomePath = string;
```

- Default: `@biomejs/biome`

Path to the `@biomejs/biome` instance that will be used for checking.

### `command`

- Type:

```ts
type command = "lint" | "check";
```

- Default: `"lint"`

Which of Biome's commands to run. `"lint"` runs the linter; `"check"` adds its
formatting and assist diagnostics, so a badly formatted file is reported as well
as one breaking a rule.

### `configFile`

- Type:

```ts
type configFile = string;
```

- Default: unset, leaving Biome to find its own

Path to the `biome.json` to check with.

### `args`

- Type:

```ts
type args = string[];
```

- Default: `[]`

Arguments passed to Biome as they are, for the flags this check does not name.
Not `--reporter`: the check asks for JSON and formats the results itself.

## TypeScript

Run with `{ use: "typescript" }`, and requires `typescript >= 5`. It type checks
the program a `tsconfig.json` describes, so every file that config includes is
checked whether or not webpack built it, and a type error in a module nothing
imports yet is still reported. Emit is forced off: webpack writes the output.

```js
new DiagnosticsPlugin({
  checks: [{ use: "typescript", configFile: "tsconfig.build.json" }],
});
```

Two things differ from the linters. A diagnostic belongs to the program rather
than to one file, so there is nothing to report a single file from and the
program is rebuilt whenever a checked file changes — [`threads`](#threads) is
not honoured either, since TypeScript spreads its own work. And `extensions`
only decides which files make the check run at all; what is checked is whatever
the config file includes.

Alongside the shared options you can pass any
[compiler option](https://www.typescriptlang.org/tsconfig/) — they override what
the config file sets, as `--strict` would on the command line.

### `typescriptPath`

- Type:

```ts
type typescriptPath = string;
```

- Default: `typescript`

Path to the `typescript` instance that will be used for checking.

### `configFile`

- Type:

```ts
type configFile = string;
```

- Default: the nearest `tsconfig.json` at or above [`context`](#context)

Path to the `tsconfig.json` that describes the program.

### `compilerOptions`

- Type:

```ts
type compilerOptions = object;
```

- Default: unset

Compiler options overriding the ones the config file sets. The same as writing
them at the top level of the check, and useful when a name collides with one of
the plugin's own.

## Adding a check

A `use` may also be an adapter of its own rather than a built-in name, so a check can ship as its own package without an entry in this one:

```js
new DiagnosticsPlugin({
  checks: [
    { use: require("diagnostics-webpack-plugin-typescript"), strict: true },
  ],
});
```

Such an adapter is an object with a `name`, and a `create` returning the five functions the plugin drives it through — what to lint, what came back, which results are errors and which warnings, how to format them, and what to release afterwards. It splits its results by their own severity and nothing else; [`reportAs`](#reportas) is applied to what it returns:

```js
module.exports = {
  name: "made-up",
  // "modules" lints the files webpack built, "glob" every file matching `files`
  filesSource: "glob",
  // Merged under the options the user passes, and under the shared options
  defaults: { extensions: ["ts"] },
  async create({ key, options, compilation }) {
    return {
      lintFiles: async (files) => runTheTool(files),
      getResults: async (results) => results,
      splitResults: (results) => ({ errors: results, warnings: [] }),
      getFormatter: async (formatter) => async (results) => format(results),
      cleanup: async () => {},
    };
  },
};
```

`label`, `filesSource`, `defaults`, `defaultExclude` and `schema` are optional; the plugin fills in the defaults of a module-scanning check that excludes `node_modules`.

## Migrating

Both plugins become one, and every option they had is still here. What changed is where an option is written and how the four that decided severity are spelled.

**Where an option goes.** `context`, `lintOnStart` and `checks` are the plugin's own and stay at the top level. Everything else is shared: write it at the top level to cover every check, or inside a `checks` entry to cover that one. `configType`, `eslintPath` and `stylelintPath` belong to a single check and go in its entry.

**Severity is one option.** `emitError`, `emitWarning`, `failOnError`, `failOnWarning` and `quiet` are [`reportAs`](#reportas), because reporting a result as a webpack error is what fails the build:

| Was                                         | Is                                |
| :------------------------------------------ | :-------------------------------- |
| `quiet: true`, `emitWarning: false`         | `reportAs: { warnings: false }`   |
| `emitError: false`                          | `reportAs: { errors: false }`     |
| `emitError: false` and `emitWarning: false` | `reportAs: false`                 |
| `failOnError: true`                         | the default                       |
| `failOnError: false`                        | `reportAs: "warning"`             |
| `failOnWarning: true`                       | `reportAs: { warnings: "error" }` |

**The build is no longer aborted from inside the plugin.** A result reported as a webpack error fails the build the way every other webpack error does — `stats.hasErrors()` is true and the CLI exits non-zero — and the assets are still written. Nothing about severity depends on `mode` any more.

**Requirements.** Node `>= 22.12`, webpack 5, and ESLint 9 or 10 / Stylelint 17 for whichever checks you run.

### From `eslint-webpack-plugin`

```diff
-const ESLintPlugin = require("eslint-webpack-plugin");
+const DiagnosticsPlugin = require("diagnostics-webpack-plugin");

 module.exports = {
   plugins: [
-    new ESLintPlugin({ extensions: ["js"], fix: true }),
+    new DiagnosticsPlugin({
+      checks: [{ use: "eslint", extensions: ["js"], fix: true }],
+    }),
   ],
 };
```

Every option `eslint-webpack-plugin` accepted, and where it is now:

| Option                 | Now                                                                                                              |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `cache`                | Unchanged, shared.                                                                                               |
| `cacheLocation`        | Unchanged, shared. The default moved to `node_modules/.cache/diagnostics-webpack-plugin/.eslintcache`.           |
| `configType`           | Unchanged, in the `eslint` entry.                                                                                |
| `context`              | Unchanged, top level.                                                                                            |
| `emitError`            | [`reportAs`](#reportas), see the table above.                                                                    |
| `emitWarning`          | [`reportAs`](#reportas), see the table above.                                                                    |
| `eslintPath`           | Unchanged, in the `eslint` entry.                                                                                |
| `exclude`              | Unchanged, shared.                                                                                               |
| `extensions`           | Unchanged, shared. Still defaults to `js`.                                                                       |
| `failOnError`          | [`reportAs`](#reportas). It defaulted to on outside `development` mode; the default no longer depends on `mode`. |
| `failOnWarning`        | [`reportAs`](#reportas), see the table above.                                                                    |
| `files`                | Unchanged, shared.                                                                                               |
| `fix`                  | Unchanged, shared.                                                                                               |
| `formatter`            | Unchanged, shared.                                                                                               |
| `lintDirtyModulesOnly` | [`lintOnStart`](#lintonstart), inverted: `lintDirtyModulesOnly: true` is `lintOnStart: false`. Top level.        |
| `outputReport`         | Unchanged, shared. It is still written even when `reportAs` is `false`.                                          |
| `quiet`                | `reportAs: { warnings: false }`.                                                                                 |
| `resourceQueryExclude` | Unchanged, shared.                                                                                               |

Any other option is passed to ESLint itself, as before.

### From `stylelint-webpack-plugin`

```diff
-const StylelintPlugin = require("stylelint-webpack-plugin");
+const DiagnosticsPlugin = require("diagnostics-webpack-plugin");

 module.exports = {
   plugins: [
-    new StylelintPlugin({ extensions: ["css"], threads: true }),
+    new DiagnosticsPlugin({
+      checks: [{ use: "stylelint", extensions: ["css"], threads: true }],
+    }),
   ],
 };
```

Every option `stylelint-webpack-plugin` accepted, and where it is now:

| Option                 | Now                                                                                                       |
| :--------------------- | :-------------------------------------------------------------------------------------------------------- |
| `cache`                | Unchanged, shared.                                                                                        |
| `cacheLocation`        | Unchanged, shared. The default moved to `node_modules/.cache/diagnostics-webpack-plugin/.stylelintcache`. |
| `context`              | Unchanged, top level.                                                                                     |
| `emitError`            | [`reportAs`](#reportas), see the table above.                                                             |
| `emitWarning`          | [`reportAs`](#reportas), see the table above.                                                             |
| `exclude`              | Unchanged, shared.                                                                                        |
| `extensions`           | Unchanged, shared. Still defaults to `css`, `scss` and `sass`.                                            |
| `failOnError`          | [`reportAs`](#reportas). It defaulted to on in every mode, and the default is still to fail on an error.  |
| `failOnWarning`        | [`reportAs`](#reportas), see the table above.                                                             |
| `files`                | Unchanged, shared.                                                                                        |
| `formatter`            | Unchanged, shared.                                                                                        |
| `lintDirtyModulesOnly` | [`lintOnStart`](#lintonstart), inverted: `lintDirtyModulesOnly: true` is `lintOnStart: false`. Top level. |
| `outputReport`         | Unchanged, shared. It is still written even when `reportAs` is `false`.                                   |
| `quiet`                | `reportAs: { warnings: false }`.                                                                          |
| `stylelintPath`        | Unchanged, in the `stylelint` entry.                                                                      |
| `threads`              | Shared now, and `"auto"` by default rather than off. Every check honours it.                              |

Any other option is passed to Stylelint itself, as before. Two more things changed for Stylelint alone:

- **Stylelint 17 or later is required.** `stylelint-webpack-plugin` accepted `13` through `17`; the merged plugin drops the older majors rather than carrying their compatibility branches forward. Stylelint 17 itself needs Node `>= 20.19`.
- **Errors and warnings are no longer swapped.** `failOnError: false` used to report errors as webpack warnings, and `failOnWarning: true` to report warnings as webpack errors. Each result now keeps its own severity unless [`reportAs`](#reportas) says otherwise — which is what those two spellings in the table above do, explicitly.

[`fix`](#fix) is a documented option now rather than one passed through to Stylelint unnamed. [`resourceQueryExclude`](#resourcequeryexclude) is shared but has no effect here: it reads the query of a module webpack built, and Stylelint is given the files matching `files` instead.

### Running both

The two plugins become one instance, and options they had in common are written once:

```diff
 module.exports = {
   plugins: [
-    new ESLintPlugin({ context: "src", failOnError: true, extensions: ["js"] }),
-    new StylelintPlugin({ context: "src", failOnError: true, extensions: ["css"] }),
+    new DiagnosticsPlugin({
+      context: "src",
+      checks: [
+        { use: "eslint", extensions: ["js"] },
+        { use: "stylelint", extensions: ["css"] },
+      ],
+    }),
   ],
 };
```

## Changelog

[Changelog](CHANGELOG.md)

## Contributing

We welcome all contributions!

If you're new here, please take a moment to review our contributing guidelines.

[CONTRIBUTING](https://github.com/webpack/diagnostics-webpack-plugin?tab=contributing-ov-file#contributing)

## License

[MIT](./LICENSE)

[npm]: https://img.shields.io/npm/v/diagnostics-webpack-plugin.svg
[npm-url]: https://npmjs.com/package/diagnostics-webpack-plugin
[node]: https://img.shields.io/node/v/diagnostics-webpack-plugin.svg
[node-url]: https://nodejs.org
[tests]: https://github.com/webpack/diagnostics-webpack-plugin/workflows/diagnostics-webpack-plugin/badge.svg
[tests-url]: https://github.com/webpack/diagnostics-webpack-plugin/actions
[cover]: https://codecov.io/gh/webpack/diagnostics-webpack-plugin/branch/main/graph/badge.svg
[cover-url]: https://codecov.io/gh/webpack/diagnostics-webpack-plugin
[discussion]: https://img.shields.io/github/discussions/webpack/webpack
[discussion-url]: https://github.com/webpack/webpack/discussions
[size]: https://packagephobia.now.sh/badge?p=diagnostics-webpack-plugin
[size-url]: https://packagephobia.now.sh/result?p=diagnostics-webpack-plugin
