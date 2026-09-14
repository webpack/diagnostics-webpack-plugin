import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const entry = join(fixtures, "two-checks-entry.js");
const trigger = join(fixtures, "two-checks-trigger.js");

const shared = {
  overrideConfigFile: join(
    import.meta.dirname,
    "config-for-tests/eslint.config.mjs",
  ),
  ignore: false,
  cache: false,
};

/**
 * @returns {EXPECTED_ANY} a compiler running two entries of the same check
 */
function pack() {
  return webpack({
    entry: "./two-checks-entry.js",
    context: fixtures,
    mode: "development",
    output: { path: join(import.meta.dirname, "outputs", "two-checks") },
    plugins: [
      new DiagnosticsPlugin({
        checks: [
          { use: "eslint", ...shared, ignoreDiagnostics: ["no-var"] },
          { use: "eslint", ...shared },
        ],
      }),
    ],
  });
}

describe("multiple checks", () => {
  let watch;

  afterEach(() => {
    if (watch) {
      watch.close();
      watch = undefined;
    }
    rmSync(entry, { force: true });
    rmSync(trigger, { force: true });
  });

  it("should report an entry's own results rather than another entry's", (t, done) => {
    writeFileSync(trigger, "const trigger = 1;\n\nmodule.exports = trigger;\n");
    writeFileSync(
      entry,
      "require('./two-checks-trigger');\n\nvar bad = 1;\n\nmodule.exports = bad;\n",
    );

    const compiler = pack();
    let rebuilding = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      // One entry is told to leave `no-var` alone, so the other one is the only
      // one reporting it — including on a rebuild that lints neither file.
      assert.strictEqual(
        stats.compilation.errors.length,
        1,
        "only the entry that reports `no-var` reports it",
      );

      if (rebuilding) {
        rebuilding = false;
        writeFileSync(
          trigger,
          "const trigger = 2;\n\nmodule.exports = trigger;\n",
        );

        return;
      }

      done();
    });
  });
});
