import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

const PLUGIN = "DiagnosticsWebpackPlugin";

/**
 * @param {EXPECTED_ANY} stats the stats of a finished build
 * @returns {EXPECTED_ANY[]} what the plugin wrote to the compilation's log
 */
function logging(stats) {
  return stats.compilation.logging.get(PLUGIN) || [];
}

describe("report as", () => {
  it("should leave each result at its own severity by default", async () => {
    const compiler = pack("full-of-problems", {});

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should keep the default when written out as undefined", async () => {
    const compiler = pack("full-of-problems", { reportAs: undefined });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should cover both severities with one value", async () => {
    const asErrors = await pack("full-of-problems", {
      reportAs: "error",
    }).runAsync();
    const asWarnings = await pack("full-of-problems", {
      reportAs: "warning",
    }).runAsync();

    assert.strictEqual(asErrors.hasErrors(), true);
    assert.strictEqual(asErrors.hasWarnings(), false);
    assert.strictEqual(asWarnings.hasErrors(), false);
    assert.strictEqual(asWarnings.hasWarnings(), true);
  });

  it("should report nothing when set to false", async () => {
    const compiler = pack("full-of-problems", { reportAs: false });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should log rather than report what is set to log", async () => {
    const stats = await pack("full-of-problems", {
      reportAs: "log",
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);

    const logged = logging(stats);

    assert.strictEqual(logged.length, 2);
    assert.deepStrictEqual(
      logged.map(({ type }) => type),
      ["error", "warn"],
    );
    assert.match(logged[0].args[0], /\[eslint\]/u);
  });

  it("should log one severity and report the other", async () => {
    const stats = await pack("full-of-problems", {
      reportAs: { errors: "log" },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), true);
    assert.deepStrictEqual(
      logging(stats).map(({ type }) => type),
      ["error"],
    );
  });

  it("should write an outputReport of what it only logged", async () => {
    const stats = await pack("full-of-problems", {
      reportAs: "log",
      outputReport: { filePath: "report-as-log.txt" },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.match(
      readFileSync(
        join(stats.compilation.compiler.outputPath, "report-as-log.txt"),
        "utf8",
      ),
      /error/u,
    );
  });

  it("should set the severities apart with an object", async () => {
    const compiler = pack("full-of-problems", {
      reportAs: { errors: "warning", warnings: "error" },
    });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.compilation.errors.length, 1);
    assert.strictEqual(stats.compilation.warnings.length, 1);
    assert.match(stats.compilation.errors[0].message, /warning/u);
  });

  it("should leave a severity the object does not name at its own", async () => {
    const quiet = await pack("full-of-problems", {
      reportAs: { warnings: false },
    }).runAsync();
    const noErrors = await pack("full-of-problems", {
      reportAs: { errors: false },
    }).runAsync();

    assert.strictEqual(quiet.hasErrors(), true);
    assert.strictEqual(quiet.hasWarnings(), false);
    assert.strictEqual(noErrors.hasErrors(), false);
    assert.strictEqual(noErrors.hasWarnings(), true);
  });

  it("should fail the build on a warning reported as an error", async () => {
    const stats = await pack("warn", {
      reportAs: { warnings: "error" },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
  });

  it("should not fail the build on an error reported as a warning", async () => {
    const stats = await pack("error", { reportAs: "warning" }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should let a clean build pass whatever it is set to", async () => {
    for (const reportAs of [
      "error",
      "warning",
      "log",
      false,
      { errors: "warning" },
    ]) {
      const stats = await pack("good", { reportAs }).runAsync();

      assert.strictEqual(stats.hasErrors(), false);
      assert.strictEqual(stats.hasWarnings(), false);
      assert.deepStrictEqual(logging(stats), []);
    }
  });

  it("should reject anything but a severity or a map of them", () => {
    for (const reportAs of [true, "info", [], ["error"], { errors: "info" }]) {
      assert.throws(
        () => pack("full-of-problems", { reportAs }),
        /reportAs(\.errors)? should be one of these/u,
      );
    }

    assert.throws(
      () => pack("full-of-problems", { reportAs: { info: "error" } }),
      /reportAs has an unknown property 'info'/u,
    );
  });
});
