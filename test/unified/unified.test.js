import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, mock } from "node:test";

import DiagnosticsPlugin from "../../src/index.js";

import { getOptions } from "../../src/options.js";

import pack from "./utils/pack.js";

const eslint = {
  use: "eslint",
  cache: false,
  overrideConfigFile: join(
    import.meta.dirname,
    "config-for-tests/eslint.config.mjs",
  ),
  ignore: false,
};
const stylelint = {
  use: "stylelint",
  cache: false,
  configFile: join(import.meta.dirname, ".stylelintrc"),
};
const checks = [eslint, stylelint];

describe("unified plugin", () => {
  it("should require at least one check", () => {
    assert.throws(() => pack("good"), /options misses the property/u);
    assert.throws(
      () => pack("good", { checks: [] }),
      /options\.checks should be a non-empty array/u,
    );
  });

  it("should reject an option the check does not understand", () => {
    assert.throws(
      () => pack("good", { checks: [{ use: "eslint", extensions: 42 }] }),
      /options\.checks\[0\]\.extensions should be one of these/u,
    );
  });

  it("should validate nothing when webpack's validate is off", () => {
    assert.doesNotThrow(() =>
      pack("good", { checks: [] }, { validate: false }),
    );
    assert.doesNotThrow(() =>
      pack(
        "good",
        { checks: [{ use: "eslint", extensions: 42 }] },
        {
          validate: false,
        },
      ),
    );
  });

  it("should accept a check named rather than written out", () => {
    // A check with nothing to configure needs no entry of its own, and still
    // reads the options written once for every check.
    const { checks: resolved } = getOptions({
      cache: false,
      checks: ["eslint", { use: "stylelint" }],
    });

    assert.deepStrictEqual(
      resolved.map(({ name }) => name),
      ["eslint", "stylelint"],
    );
    assert.strictEqual(resolved[0].options.cache, false);
  });

  it("should reject a check it does not know", () => {
    assert.throws(
      () => new DiagnosticsPlugin({ checks: [{ use: "prettier" }] }),
      /unknown check 'prettier'/u,
    );
  });

  it("should reject an adapter that cannot lint", () => {
    assert.throws(
      () => new DiagnosticsPlugin({ checks: [{ use: { name: "x" } }] }),
      /a `name` and a `create` function/u,
    );
  });

  it("should report the problems of every check it runs", async () => {
    const compiler = pack("both", { checks });
    const stats = await compiler.runAsync();
    const messages = [
      ...stats.compilation.errors,
      ...stats.compilation.warnings,
    ].map(({ message }) => message);

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(stats.hasWarnings(), true);
    assert.match(messages.join("\n"), /bad.js/u);
    assert.match(messages.join("\n"), /bad.scss/u);
  });

  it("should lint nothing to report when every file is fine", async () => {
    const compiler = pack("good", { checks });
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should run a check given no options of its own", async () => {
    const compiler = pack("both", {
      // The bundled config of this repository is the one ESLint finds here.
      exclude: "**/*.js",
      checks: [{ use: "eslint" }, stylelint],
    });
    const stats = await compiler.runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /bad.scss/u);
  });

  it("should let a check override a shared option", async () => {
    const compiler = pack("both", {
      reportAs: false,
      checks: [eslint, { ...stylelint, reportAs: "error" }],
    });
    const stats = await compiler.runAsync();
    const [error] = stats.compilation.errors;

    assert.strictEqual(stats.compilation.errors.length, 1);
    assert.match(error.message, /bad.scss/u);
  });

  it("should run the same check more than once", async () => {
    const compiler = pack("both", {
      checks: [
        { ...eslint, files: "bad.js" },
        { ...eslint, files: "index.js" },
      ],
    });
    const stats = await compiler.runAsync();
    const messages = stats.compilation.errors.map(({ message }) => message);

    assert.strictEqual(messages.length, 1);
    assert.match(messages[0], /bad.js/u);
  });

  it("should run a check shipped outside this package", async () => {
    const lintFiles = mock.fn(async () => [{ file: "checked" }]);
    const compiler = pack("good", {
      checks: [
        {
          use: {
            name: "made-up",
            create: async () => ({
              lintFiles,
              getResults: async (results) => results,
              splitResults: (results) => ({ errors: results, warnings: [] }),
              getFormatter: async () => async () => "made up problem",
              cleanup: async () => {},
            }),
          },
        },
      ],
    });
    const stats = await compiler.runAsync();

    assert.ok(lintFiles.mock.callCount() > 0);
    assert.strictEqual(
      stats.compilation.errors[0].message,
      "[made-up] made up problem",
    );
  });

  it("should apply reportAs to a check that implements it not at all", async () => {
    const adapter = {
      name: "made-up",
      create: async () => ({
        lintFiles: async () => [{ file: "checked" }],
        getResults: async (results) => results,
        splitResults: (results) => ({ errors: [], warnings: results }),
        getFormatter: async () => async () => "made up problem",
        cleanup: async () => {},
      }),
    };
    const run = (options) =>
      pack("good", { ...options, checks: [{ use: adapter }] }).runAsync();

    const reported = await run({});
    const dropped = await run({ reportAs: "error" });
    const silent = await run({ reportAs: false });

    assert.strictEqual(reported.compilation.warnings.length, 1);
    assert.strictEqual(dropped.hasWarnings(), false);
    assert.strictEqual(silent.hasWarnings(), false);
  });

  it("should report every check where a shared reportAs says", async () => {
    const compiler = pack("both", { reportAs: "warning", checks });
    const stats = await compiler.runAsync();
    const messages = stats.compilation.warnings.map(({ message }) => message);

    assert.strictEqual(stats.hasErrors(), false);
    assert.match(messages.join("\n"), /bad\.js/u);
    assert.match(messages.join("\n"), /bad\.scss/u);
  });

  it("should join the reports of every check into one output report", async () => {
    const filePath = join(import.meta.dirname, "outputs", "report.json");
    const compiler = pack("both", {
      outputReport: { filePath, formatter: "json" },
      checks,
    });

    await compiler.runAsync();

    assert.strictEqual(existsSync(filePath), true);

    const [eslintReport, stylelintReport] = readFileSync(filePath, "utf8")
      .split("\n")
      .map((report) => JSON.parse(report));

    assert.strictEqual(eslintReport.length, 1);
    assert.ok(eslintReport[0].filePath.includes("bad.js"));
    assert.strictEqual(stylelintReport.length, 1);
    assert.ok(stylelintReport[0].source.includes("bad.scss"));
  });
});
