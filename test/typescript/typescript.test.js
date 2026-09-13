import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

describe("typescript", () => {
  it("should report nothing when the types are right", async () => {
    const stats = await pack("good").runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report a type error as a webpack error", async () => {
    const stats = await pack("bad").runAsync();

    assert.strictEqual(stats.hasErrors(), true);

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /\[typescript\]/u);
    assert.match(message, /used\.ts/u);
    assert.match(message, /TS2322/u);
  });

  it("should check a file webpack never built", async () => {
    const stats = await pack("bad").runAsync();
    const seen = stats.compilation.errors.map((e) => e.message).join();

    // Nothing imports it, so only the program's own file set reaches it.
    assert.match(seen, /orphan\.ts/u);
  });

  it("should report every diagnostic when none is ignored", async () => {
    const stats = await pack("ignored").runAsync();
    const [{ message }] = stats.compilation.errors;

    assert.match(message, /TS2322/u);
    assert.match(message, /TS2307/u);
  });

  it("should leave out the diagnostics whose code is ignored", async () => {
    const stats = await pack("ignored", {
      ignoreDiagnostics: [2322],
    }).runAsync();
    const [{ message }] = stats.compilation.errors;

    assert.doesNotMatch(message, /TS2322/u);
    assert.match(message, /TS2307/u);
  });

  it("should report nothing when every diagnostic is ignored", async () => {
    const stats = await pack("ignored", {
      ignoreDiagnostics: [2322, 2307],
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report TypeScript's own word on a config it cannot read", async () => {
    const stats = await pack("bad", {
      configFile: "/nowhere/tsconfig.json",
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /TS5083/u);
  });

  it("should format with a formatter written in the configuration", async () => {
    const stats = await pack("bad", {
      formatter: (diagnostics) =>
        `saw ${diagnostics.length} of them, first is TS${diagnostics[0].code}`,
    }).runAsync();

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /saw 2 of them, first is TS2322/u);
  });

  it("should let reportAs turn the errors into warnings", async () => {
    const stats = await pack("bad", { reportAs: "warning" }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), true);
  });
});
