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
   * @param {{ context?: string, fixable?: number }=} setup where it is built, and whether ESLint finds what `fix` can write
   * @returns {Promise<string[]>} what it linted, by name
   */
  const build = async (
    options = {},
    { context = project, fixable = 0 } = {},
  ) => {
    mock()._reset();
    mock()._readAcrossFiles(true);
    mock()._fixable(fixable);

    const compiler = webpack({
      context,
      entry: "./entry.js",
      mode: "development",
      output: { path: join(context, "dist") },
      plugins: [
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

    await new Promise((resolve, reject) => {
      compiler.run((err) => (err ? reject(err) : resolve()));
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
});
