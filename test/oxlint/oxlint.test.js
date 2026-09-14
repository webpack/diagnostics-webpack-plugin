import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

describe("oxlint", () => {
  it("should report nothing when the files are fine", async () => {
    const stats = await pack("good").runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report what oxlint rates an error as one", async () => {
    const stats = await pack("bad").runAsync();

    assert.strictEqual(stats.hasErrors(), true);

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /\[oxlint\]/u);
    assert.match(message, /rules\.js:3:1/u);
    assert.match(message, /no-debugger/u);
  });

  it("should report what oxlint rates a warning as one", async () => {
    const stats = await pack("bad").runAsync();

    assert.strictEqual(stats.hasWarnings(), true);

    const [{ message }] = stats.compilation.warnings;

    assert.match(message, /no-unused-vars/u);
    assert.doesNotMatch(message, /no-debugger/u);
  });

  it("should keep every problem a file holds, not the last of them", async () => {
    const stats = await pack("bad").runAsync();
    const [{ message }] = stats.compilation.warnings;

    // One result carries a file's diagnostics, so two in one file both survive
    // being remembered under that file.
    assert.match(message, /twice\.js:1:7/u);
    assert.match(message, /twice\.js:3:7/u);
  });

  it("should leave out what ignoreDiagnostics names", async () => {
    const stats = await pack("bad", {
      ignoreDiagnostics: ["eslint(no-debugger)"],
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);

    const [{ message }] = stats.compilation.warnings;

    assert.match(message, /no-unused-vars/u);
  });

  it("should let reportAs send both to warnings", async () => {
    const stats = await pack("bad", { reportAs: "warning" }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should format with a formatter written in the configuration", async () => {
    const stats = await pack("bad", {
      formatter: (results) =>
        `saw ${results.length} file(s), first holds ${results[0].diagnostics.length}`,
    }).runAsync();

    assert.match(stats.compilation.errors[0].message, /saw 1 file\(s\)/u);
  });

  it("should leave oxlint to refuse a format of one's own", async () => {
    // The check reads oxlint's JSON, and oxlint itself declines to be asked
    // twice rather than answering in something this cannot read.
    const stats = await pack("bad", {
      args: ["--format=stylish"],
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /--format/u);
  });

  it("should say so when oxlint refuses to run", async () => {
    const stats = await pack("bad", { args: ["--not-a-flag"] }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /\[oxlint\]/u);
  });

  it("should say so when it answers with something other than JSON", async () => {
    const stats = await pack("bad", {
      oxlintPath: join(import.meta.dirname, "mock", "oxlint-gibberish"),
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(
      stats.compilation.errors[0].message,
      /other than the JSON it was asked for/u,
    );
  });

  it("should say so when it cannot be found", async () => {
    const stats = await pack("bad", { oxlintPath: "not-a-linter" }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /not-a-linter/u);
  });
});
