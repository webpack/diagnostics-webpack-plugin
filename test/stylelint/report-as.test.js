import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

describe("report as", () => {
  it("should leave each result at its own severity by default", async () => {
    const compiler = pack("full-of-problems", {});

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should cover both severities with one value", async () => {
    const asErrors = await pack("full-of-problems", {
      reportAs: "error",
    }).runAsync();

    assert.strictEqual(asErrors.hasErrors(), true);
    assert.strictEqual(asErrors.hasWarnings(), false);
  });

  it("should set the severities apart with an object", async () => {
    const compiler = pack("full-of-problems", {
      reportAs: { warnings: false },
    });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report nothing when set to false", async () => {
    const compiler = pack("full-of-problems", { reportAs: false });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should log rather than report what is set to log", async () => {
    const compiler = pack("full-of-problems", { reportAs: "log" });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);

    const logged = stats.compilation.logging.get("DiagnosticsWebpackPlugin");

    assert.deepStrictEqual(
      logged.map((/** @type {EXPECTED_ANY} */ entry) => entry.type),
      ["error", "warn"],
    );
    assert.match(logged[0].args[0], /\[stylelint\]/u);
  });

  it("should let a clean build pass whatever it is set to", async () => {
    const compiler = pack("good", { reportAs: "error" });

    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });
});
