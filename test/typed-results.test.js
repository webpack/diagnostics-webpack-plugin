import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const require = createRequire(import.meta.url);
const eslintPath = join(import.meta.dirname, "mock/eslint-recorder");
const mock = () => require(eslintPath);

describe("typed linting between builds", () => {
  /** @type {string} */
  let project;
  /** @type {string[]} what the last build reported */
  let reports = [];
  // A write in the same millisecond as the last one is still a write.
  let tick = Date.now() - 60_000;

  /**
   * @param {string} name the file
   * @param {string} text what it holds
   */
  const write = (name, text) => {
    writeFileSync(join(project, name), text);
    tick += 1000;
    utimesSync(join(project, name), new Date(tick), new Date(tick));
  };

  beforeEach(() => {
    // Under the fixtures, so that its TypeScript is this package's.
    project = mkdtempSync(join(import.meta.dirname, "fixtures", "typed-"));
    write("tsconfig.json", '{ "compilerOptions": { "allowJs": true } }');
    write("leaf.js", "module.exports = 1;\n");
    write("other.js", "module.exports = 2;\n");
    write("entry.js", "require('./leaf.js');\nrequire('./other.js');\n");
  });

  afterEach(() => rmSync(project, { recursive: true, force: true }));

  /**
   * One build, as a CI run or `webpack` on the command line makes it.
   * @param {object=} options what the check is configured with
   * @param {{ context?: string, fixable?: number, report?: string, plugins?: import("webpack").WebpackPluginInstance[] }=} setup where it is built, whether ESLint finds what `fix` can write, the file it finds an error in, and plugins to run before the check
   * @returns {Promise<string[]>} what it linted, by name
   */
  const build = async (
    options = {},
    { context = project, fixable = 0, report = "", plugins = [] } = {},
  ) => {
    mock()._reset();
    mock()._readAcrossFiles(true);
    mock()._fixable(fixable);
    mock()._report(report);

    const compiler = webpack({
      context,
      entry: "./entry.js",
      mode: "development",
      output: { path: join(context, "dist") },
      plugins: [
        ...plugins,
        new DiagnosticsPlugin({
          checks: [
            {
              use: "eslint",
              eslintPath,
              cacheLocation: join(context, "cache", ".eslintcache"),
              ...options,
            },
          ],
        }),
      ],
    });

    reports = await new Promise((resolve, reject) => {
      compiler.run((err, stats) =>
        err
          ? reject(err)
          : resolve(stats.compilation.errors.map(({ message }) => message)),
      );
    });
    await new Promise((resolve) => {
      compiler.close(resolve);
    });

    return mock()
      ._calls.flat()
      .map((file) => file.replace(/^.*[\\/]/u, ""))
      .toSorted();
  };

  it("should lint nothing again that nothing it imports has changed", async () => {
    assert.deepStrictEqual(await build(), ["entry.js", "leaf.js", "other.js"]);
    assert.deepStrictEqual(await build(), []);
  });

  it("should report again what it found in a file it does not lint again", async () => {
    await build({}, { report: "leaf.js" });
    assert.strictEqual(reports.length, 1);
    assert.match(reports[0], /leaf\.js/u);

    // ESLint would find nothing now: what is reported is what was kept.
    assert.deepStrictEqual(await build(), []);
    assert.strictEqual(reports.length, 1);
    assert.match(reports[0], /leaf\.js/u);
  });

  it("should lint again a file whose import changed, though it did not", async () => {
    await build();
    write("leaf.js", "module.exports = 3;\n");

    // What `eslint-webpack-plugin` answers for from ESLint's cache: the entry
    // did not change, and what a typed rule says of it can have.
    assert.deepStrictEqual(await build(), ["entry.js", "leaf.js"]);
  });

  it("should lint everything again once the config file changes", async () => {
    await build();
    write(
      "tsconfig.json",
      '{ "compilerOptions": { "allowJs": true, "strict": true } }',
    );

    assert.deepStrictEqual(await build(), ["entry.js", "leaf.js", "other.js"]);
  });

  it("should keep what it found next to ESLint's cache", async () => {
    await build();

    const path = join(project, "cache", ".eslintcache.typed-results.json");

    assert.ok(existsSync(path));

    const { entries } = JSON.parse(readFileSync(path, "utf8"));

    assert.strictEqual(Object.keys(entries).length, 3);
  });

  it("should lint everything every time with the cache off", async () => {
    await build({ cache: false });

    assert.deepStrictEqual(await build({ cache: false }), [
      "entry.js",
      "leaf.js",
      "other.js",
    ]);
  });

  it("should lint again what `fix` has something to write in", async () => {
    await build({ fix: true }, { fixable: 1 });

    assert.deepStrictEqual(await build({ fix: true }, { fixable: 1 }), [
      "entry.js",
      "leaf.js",
      "other.js",
    ]);
    assert.strictEqual(mock()._fixed.flat().length, 3);
  });

  it("should reuse what `fix` has nothing to write in", async () => {
    await build({ fix: true });

    assert.deepStrictEqual(await build({ fix: true }), []);
  });

  it("should keep ESLint's cache when asked for and no TypeScript can follow imports", async () => {
    // Outside the package, where no TypeScript resolves.
    const bare = mkdtempSync(join(tmpdir(), "typed-bare-"));

    try {
      writeFileSync(join(bare, "entry.js"), "module.exports = 1;\n");

      await build({ cache: true }, { context: bare });
      assert.strictEqual(mock()._built.at(-1).cache, true);

      await build({}, { context: bare });
      assert.strictEqual(mock()._built.at(-1).cache, false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("should keep results for a file ESLint has no config for", async () => {
    write("ignored.js", "module.exports = 4;\n");
    write("entry.js", "require('./leaf.js');\nrequire('./ignored.js');\n");

    assert.deepStrictEqual(await build(), [
      "entry.js",
      "ignored.js",
      "leaf.js",
    ]);
    assert.deepStrictEqual(await build(), []);
  });

  it("should keep nothing for a file gone by the time it is linted", async () => {
    const removeLeaf = {
      /** @param {import("webpack").Compiler} compiler the compiler */
      apply(compiler) {
        compiler.hooks.compilation.tap("remove-leaf", (compilation) => {
          compilation.hooks.finishModules.tap("remove-leaf", () => {
            rmSync(join(project, "leaf.js"));
          });
        });
      },
    };

    assert.deepStrictEqual(await build({}, { plugins: [removeLeaf] }), [
      "entry.js",
      "leaf.js",
      "other.js",
    ]);

    const { entries } = JSON.parse(
      readFileSync(
        join(project, "cache", ".eslintcache.typed-results.json"),
        "utf8",
      ),
    );

    assert.deepStrictEqual(
      Object.keys(entries)
        .map((file) => file.replace(/^.*[\\/]/u, ""))
        .toSorted(),
      ["entry.js", "other.js"],
    );
  });
});
