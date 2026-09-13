import assert from "node:assert/strict";
import { describe, it } from "node:test";

import stylelintPack from "./stylelint/utils/pack.js";
import pack from "./utils/pack.js";

const reported = async (/** @type {EXPECTED_ANY} */ ignoreDiagnostics) => {
  const stats = await pack("full-of-problems", {
    ignoreDiagnostics,
  }).runAsync();
  const { errors, warnings } = stats.compilation;

  return [...errors, ...warnings].map(({ message }) => message).join("\n");
};

describe("ignoreDiagnostics", () => {
  it("should report every rule when nothing is named", async () => {
    const messages = await reported(undefined);

    assert.match(messages, /no-unused-vars/u);
    assert.match(messages, /no-else-return/u);
  });

  it("should leave out a rule named as a string", async () => {
    const messages = await reported("no-unused-vars");

    assert.doesNotMatch(messages, /no-unused-vars/u);
    assert.match(messages, /consistent-return/u);
  });

  it("should leave out each of a list", async () => {
    const messages = await reported(["no-unused-vars", "consistent-return"]);

    assert.doesNotMatch(messages, /no-unused-vars/u);
    assert.doesNotMatch(messages, /consistent-return/u);
    assert.match(messages, /space-unary-ops/u);
  });

  it("should leave out what a severity matches", async () => {
    const stats = await pack("full-of-problems", {
      ignoreDiagnostics: { severity: "warning" },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should leave out a rule in the files a glob matches", async () => {
    const inTheFile = await reported({
      code: "no-unused-vars",
      file: "**/full-of-problems.js",
    });
    const elsewhere = await reported({
      code: "no-unused-vars",
      file: "**/somewhere-else.js",
    });

    assert.doesNotMatch(inTheFile, /no-unused-vars/u);
    assert.match(elsewhere, /no-unused-vars/u);
  });

  it("should leave out what a function of its own answers for", async () => {
    const messages = await reported(
      (/** @type {EXPECTED_ANY} */ { code, severity, text, file }) => {
        assert.ok(file.endsWith("full-of-problems.js"));
        assert.ok(typeof text === "string" && text.length > 0);

        return severity === "error" && code !== "consistent-return";
      },
    );

    assert.doesNotMatch(messages, /no-unused-vars/u);
    assert.match(messages, /consistent-return/u);
    assert.match(messages, /no-else-return/u);
  });

  it("should be read by every check, not the linter of one", async () => {
    // The same option over a check that is not ESLint, naming a rule only
    // Stylelint has.
    const stats = await stylelintPack("error", {
      ignoreDiagnostics: "color-named",
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should keep what a check could not put a file to", async () => {
    // A match naming a file is about the files it names; something the check
    // reported of no file in particular is not one of them.
    const stats = await pack("full-of-problems", {
      // A configuration ESLint cannot read at all, which it says of no file.
      overrideConfigFile: "/nowhere/eslint.config.mjs",
      ignoreDiagnostics: { file: "**/*.js" },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /nowhere/u);
  });

  it("should report what a check cannot leave anything out of", async () => {
    const stats = await pack("good", {
      ignoreDiagnostics: "made-up",
      // An adapter with no `filterResults` of its own.
      use: {
        name: "made-up",
        create: async () => ({
          cleanup: async () => {},
          getFormatter: async () => async () => "made up problem",
          getResults: async (/** @type {EXPECTED_ANY[]} */ results) => results,
          lintFiles: async () => [{ made: "up" }],
          splitResults: (/** @type {EXPECTED_ANY[]} */ results) => ({
            errors: results,
            warnings: [],
          }),
        }),
      },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /made up problem/u);
  });

  it("should count what is left rather than what was found", async () => {
    const messages = await reported("indent");

    // ESLint's formatter prints the counts a result carries, so a result the
    // plugin took messages out of has to carry the ones left.
    assert.doesNotMatch(messages, /indent/u);
    assert.match(messages, /3 errors, 3 warnings/u);
  });
});
