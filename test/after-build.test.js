// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import assert from "node:assert/strict";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const entry = join(fixtures, "after-entry.js");
const leaf = join(fixtures, "after-leaf.js");

// What the check says of the entry, which an edit to the leaf changes: a typed
// rule reading the leaf through the entry's import.
let generation = 0;
let failFormatting = false;

const adapter = {
  name: "across",
  resultPath: (/** @type {{ file: string }} */ result) => result.file,
  readsAcrossFiles: () => true,
  create: async () => ({
    lintFiles: async (/** @type {string[]} */ files) =>
      files
        .filter((file) => file === entry)
        .map((file) => ({ file, text: `found ${generation}` })),
    getResults: async (/** @type {unknown[]} */ results) => results,
    splitResults: (/** @type {unknown[]} */ results) => ({
      errors: results,
      warnings: [],
    }),
    getFormatter: async () => {
      if (failFormatting) throw new Error("cannot format");

      return async (/** @type {{ text: string }[]} */ results) =>
        results.map((result) => result.text).join("\n");
    },
    cleanup: async () => {},
  }),
};

describe("lintDependentsAfterBuild", () => {
  let watching;
  /** @type {string[]} */
  let logged;

  beforeEach(() => {
    generation = 0;
    failFormatting = false;
    logged = [];
    writeFileSync(leaf, "module.exports = 1;\n");
    writeFileSync(entry, "require('./after-leaf');\n");

    // Written well before the watch starts, or its first rebuild counts them
    // as changed along with the edit.
    const past = new Date(Date.now() - 60_000);

    for (const file of [entry, leaf]) utimesSync(file, past, past);
  });

  afterEach(() => {
    if (watching) watching.close();
    rmSync(entry, { force: true });
    rmSync(leaf, { force: true });
  });

  /**
   * @param {object} check the entry of `checks`
   * @param {(log: string, stats: import("webpack").Stats) => boolean} until when the log says what the test waits for
   * @param {() => void} done done
   * @param {(stats: import("webpack").Stats) => void=} rebuilt what to do once a rebuild is over
   */
  const run = (check, until, done, rebuilt = () => {}) => {
    /** @type {import("webpack").Stats | undefined} */
    let stats;
    const compiler = webpack({
      context: fixtures,
      entry: "./after-entry.js",
      mode: "development",
      output: { path: join(import.meta.dirname, "outputs") },
      infrastructureLogging: {
        level: "info",
        stream: /** @type {EXPECTED_ANY} */ ({
          isTTY: false,
          write: (/** @type {string} */ text) => {
            logged.push(text);

            if (until(logged.join(""), stats)) done();
          },
        }),
      },
      plugins: [
        new DiagnosticsPlugin({
          checks: [{ use: adapter, lintDependentsAfterBuild: true, ...check }],
        }),
      ],
    });
    let first = true;

    watching = compiler.watch({}, (err, current) => {
      assert.strictEqual(err, null);
      stats = current;

      if (!first) {
        rebuilt(current);

        return;
      }

      first = false;
      generation = 1;
      writeFileSync(leaf, "module.exports = 2;\n");
    });
  };

  it("should print what changes once the rest is linted, and carry it into the next build", (t, done) => {
    let printed = false;

    run(
      {},
      (log, stats) => {
        if (printed || !/found 1/u.test(log)) return false;

        printed = true;
        // The build itself reported the entry from its last run.
        assert.match(stats.compilation.errors[0].message, /found 0/u);
        assert.match(log, /what the last build reported has changed/u);

        // The next build reports what was found after this one.
        writeFileSync(leaf, "module.exports = 3;\n");

        return false;
      },
      done,
      (stats) => {
        if (!printed) return;

        assert.match(stats.compilation.errors[0].message, /found 1/u);
        done();
      },
    );
  });

  it("should lint everything with the build for a check writing an output report", (t, done) => {
    run(
      { outputReport: { filePath: "after-report.txt" } },
      () => false,
      done,
      (stats) => {
        // Nothing waits for after the build: the entry is reported as found.
        assert.match(stats.compilation.errors[0].message, /found 1/u);
        done();
      },
    );
  });

  it("should do the same for a check that globs its files", (t, done) => {
    run(
      { files: ["after-entry.js", "after-leaf.js"] },
      (log) => /found 1/u.test(log),
      done,
    );
  });

  it("should print why linting the rest failed", (t, done) => {
    run(
      {},
      (log) => /cannot format/u.test(log),
      done,
      () => {
        // Formatting fails once the build is over, so only the run after it
        // has nowhere to report but the terminal.
        failFormatting = true;
      },
    );
  });
});
