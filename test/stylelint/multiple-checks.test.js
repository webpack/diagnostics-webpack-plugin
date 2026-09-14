import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../../src/index.js";

const testDir = import.meta.dirname;
const shared = { cache: false, threads: false };

/**
 * @param {EXPECTED_ANY[]} checks the entries to run
 * @returns {Promise<EXPECTED_ANY>} what the build reported
 */
function reported(checks) {
  const compiler = webpack({
    context: join(testDir, "fixtures", "error"),
    mode: "development",
    entry: "./index",
    output: { path: join(testDir, "outputs", "multiple-checks") },
    plugins: [new DiagnosticsPlugin({ checks })],
  });

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) reject(err);
      else compiler.close(() => resolve(stats));
    });
  });
}

// The entry that reports, and one configured to report nothing at all.
const reporting = {
  use: "stylelint",
  ...shared,
  configFile: join(testDir, ".stylelintrc"),
};
const silent = {
  use: "stylelint",
  ...shared,
  config: { rules: {} },
  customSyntax: "postcss-scss",
};

describe("multiple checks", () => {
  it("should lint under an entry's own options rather than another's", async () => {
    const alone = await reported([reporting]);

    assert.strictEqual(alone.compilation.errors.length, 1);

    // Each entry loads the tool for itself, so the options of the one written
    // last are not what the one before it lints under.
    const together = await reported([reporting, silent]);

    assert.strictEqual(together.compilation.errors.length, 1);
    assert.strictEqual(
      together.compilation.errors[0].message,
      alone.compilation.errors[0].message,
    );
  });
});
