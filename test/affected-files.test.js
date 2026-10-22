import assert from "node:assert/strict";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const entry = join(fixtures, "affected-entry.js");
const leaf = join(fixtures, "affected-leaf.js");

/** @type {string[][]} */
const calls = [];

// A check that reads across files and cannot say which of them a change
// reaches, because asking throws.
const adapter = {
  name: "across",
  resultPath: (/** @type {{ file: string }} */ result) => result.file,
  readsAcrossFiles: () => true,
  affectedFiles: async () => {
    throw new Error("cannot tell");
  },
  create: async () => ({
    lintFiles: async (/** @type {string[]} */ files) => {
      calls.push(files);

      return [];
    },
    getResults: async (/** @type {unknown[]} */ results) => results,
    splitResults: () => ({ errors: [], warnings: [] }),
    getFormatter: async () => async () => "",
    cleanup: async () => {},
  }),
};

let watching;

afterEach(() => {
  if (watching) watching.close();
  rmSync(entry, { force: true });
  rmSync(leaf, { force: true });
});

it("should lint every file again when a check cannot say what a change reaches", (t, done) => {
  writeFileSync(leaf, "module.exports = 1;\n");
  writeFileSync(entry, "require('./affected-leaf');\n");

  const past = new Date(Date.now() - 60_000);

  for (const file of [entry, leaf]) utimesSync(file, past, past);

  const compiler = webpack({
    context: fixtures,
    entry: "./affected-entry.js",
    mode: "development",
    output: { path: join(import.meta.dirname, "outputs") },
    plugins: [new DiagnosticsPlugin({ checks: [{ use: adapter }] })],
  });
  let first = true;

  watching = compiler.watch({}, (err, stats) => {
    assert.strictEqual(err, null);
    assert.strictEqual(stats.hasErrors(), false);

    if (first) {
      first = false;
      calls.length = 0;
      writeFileSync(leaf, "module.exports = 2;\n");

      return;
    }

    // Not knowing is answered as before: every file, and no failed build.
    assert.strictEqual(calls.flat().length, 2);
    done();
  });
});
