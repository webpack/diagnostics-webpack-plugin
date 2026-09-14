import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

describe("formatter", () => {
  it("should use default formatter", async () => {
    const compiler = pack("error");
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), true);
    assert.ok(stats.compilation.errors[0].message);
  });

  it("should use default formatter when invalid", async () => {
    const compiler = pack("error", { formatter: "invalid" });
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), true);
    assert.ok(stats.compilation.errors[0].message);
  });

  it("should use string formatter", async () => {
    const compiler = pack("error", { formatter: "json" });
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), true);
    assert.ok(stats.compilation.errors[0].message);
  });

  it("should use function formatter", async () => {
    // Use dynamic import for ESM-only stylelint v17
    // eslint-disable-next-line import/no-unresolved
    const stylelintModule = await import("stylelint");
    const stylelint = stylelintModule.default || stylelintModule;
    const verboseFormatter = await stylelint.formatters.verbose;

    const compiler = pack("error", { formatter: verboseFormatter });
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), true);
    assert.ok(stats.compilation.errors[0].message);
  });

  it("should tell a formatter what the rules it reports were", async () => {
    /** @type {EXPECTED_ANY} */
    let given;

    const compiler = pack("error", {
      formatter: (results, returnValue) => {
        given = returnValue;

        return "reported";
      },
    });
    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    // What a formatter looks a warning's rule up in, which a lint answers with
    // next to the results rather than on them.
    assert.deepStrictEqual(given.ruleMetadata["color-named"], {
      url: "https://stylelint.io/user-guide/rules/color-named",
    });
  });
});
