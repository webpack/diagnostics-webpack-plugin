import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const context = join(import.meta.dirname, "fixtures", "unbuilt-css");
const style = join(context, "orphan.css");

/**
 * A check counting the runs of its tool, and saying it read a file it was
 * never handed so that both compilations can be asked what they watch.
 * @param {string[]} runs where each run records the files it was given
 * @returns {EXPECTED_ANY} the adapter to run
 */
function counted(runs) {
  return {
    name: "counted",
    filesSource: "glob",
    resultPath: (/** @type {EXPECTED_ANY} */ result) => result.filePath,
    create: async () => ({
      cleanup: async () => {},
      getFormatter: async () => async (/** @type {EXPECTED_ANY[]} */ results) =>
        results.map((result) => result.filePath).join(","),
      getResults: async (/** @type {EXPECTED_ANY[]} */ raw) => raw,
      lintFiles: async (/** @type {string[]} */ files) => {
        runs.push(files.join(","));

        return files.map((filePath) => ({ filePath }));
      },
      readFiles: () => [style],
      splitResults: (/** @type {EXPECTED_ANY[]} */ results) => ({
        errors: results,
        warnings: [],
      }),
    }),
  };
}

/**
 * @param {EXPECTED_ANY} check the options of the check each compiler runs
 * @param {EXPECTED_ANY=} second the options of the second compiler's check
 * @returns {Promise<EXPECTED_ANY>} the stats of both compilers
 */
function build(check, second = check) {
  const config = (
    /** @type {string} */ name,
    /** @type {EXPECTED_ANY} */ own,
  ) => ({
    name,
    context,
    mode: "development",
    entry: "./index.js",
    output: { path: join(import.meta.dirname, "outputs", name) },
    plugins: [
      new DiagnosticsPlugin({
        checks: [{ files: context, extensions: ["css"], ...own }],
      }),
    ],
  });

  return new Promise((resolve, reject) => {
    webpack([config("client", check), config("server", second)]).run(
      (err, stats) => {
        if (err) reject(err);
        else resolve(stats);
      },
    );
  });
}

describe("multi compiler", () => {
  it("should drive the tool once for two compilers over the same files", async () => {
    /** @type {string[]} */
    const runs = [];
    const stats = await build({ use: counted(runs) });

    assert.strictEqual(runs.length, 1, "the tool ran once for both compilers");

    // Both still report it: the second compilation joined the run rather than
    // going without one.
    for (const compilation of stats.stats.map((one) => one.compilation)) {
      assert.match(compilation.errors[0].message, /orphan\.css/u);
    }
  });

  it("should tell both compilations what the run read", async () => {
    /** @type {string[]} */
    const runs = [];
    const stats = await build({ use: counted(runs) });

    for (const compilation of stats.stats.map((one) => one.compilation)) {
      assert.ok(
        [...compilation.fileDependencies].includes(style),
        "the file the check said it read is watched by both",
      );
    }
  });

  it("should drive the tool for each compiler when the options cannot be compared", async () => {
    /** @type {string[]} */
    const runs = [];
    /** @type {EXPECTED_ANY} */
    const circular = {};

    circular.itself = circular;

    // Two runs are only shared when they can be told apart from other ones,
    // and options that cannot be written down say nothing either way.
    await build({ use: counted(runs), plugin: circular });

    assert.strictEqual(runs.length, 2);
  });

  it("should drive the tool for each compiler when the checks differ", async () => {
    /** @type {string[]} */
    const runs = [];

    await build(
      { use: counted(runs), fix: false },
      { use: counted(runs), fix: true },
    );

    assert.strictEqual(runs.length, 2, "a check configured otherwise runs");
  });
});
