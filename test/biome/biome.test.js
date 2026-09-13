import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

describe("biome", () => {
  it("should report nothing when the files are fine", async () => {
    const stats = await pack("good").runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report what Biome rates an error as one", async () => {
    const stats = await pack("bad").runAsync();

    assert.strictEqual(stats.hasErrors(), true);

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /\[biome\]/u);
    assert.match(message, /rules\.js:3:1/u);
    assert.match(message, /noDebugger/u);
  });

  it("should report what Biome rates a warning as one", async () => {
    const stats = await pack("bad").runAsync();

    assert.strictEqual(stats.hasWarnings(), true);

    const [{ message }] = stats.compilation.warnings;

    assert.match(message, /noUnusedVariables/u);
    assert.doesNotMatch(message, /noDebugger/u);
  });

  it("should keep every problem a file holds, not the last of them", async () => {
    const stats = await pack("bad").runAsync();
    const [{ message }] = stats.compilation.warnings;

    assert.match(message, /twice\.js:1:7/u);
    assert.match(message, /twice\.js:3:7/u);
  });

  it("should leave out what ignoreDiagnostics names", async () => {
    const stats = await pack("bad", {
      ignoreDiagnostics: ["lint/suspicious/noDebugger"],
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);

    const [{ message }] = stats.compilation.warnings;

    assert.match(message, /noUnusedVariables/u);
  });

  it("should let reportAs send both to warnings", async () => {
    const stats = await pack("bad", { reportAs: "warning" }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), true);
  });

  it("should run the linter alone by default", async () => {
    const stats = await pack("format").runAsync();

    // The file is badly formatted and breaks no lint rule, so the linter has
    // nothing to say about it.
    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should add Biome's formatting when told to check", async () => {
    const stats = await pack("format", { command: "check" }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /messy\.js/u);
    assert.match(stats.compilation.errors[0].message, /format/u);
  });

  it("should format with a formatter written in the configuration", async () => {
    const stats = await pack("bad", {
      formatter: (results) => `saw ${results.length} file(s)`,
    }).runAsync();

    assert.match(stats.compilation.errors[0].message, /saw 1 file\(s\)/u);
  });

  it("should say so when Biome refuses to run", async () => {
    const stats = await pack("bad", { args: ["--not-a-flag"] }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /\[biome\]/u);
  });

  it("should say so when it cannot be found", async () => {
    const stats = await pack("bad", { biomePath: "not-a-linter" }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /not-a-linter/u);
  });
});
