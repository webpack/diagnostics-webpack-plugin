import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

const reported = async (/** @type {EXPECTED_ANY} */ diagnosticOptions) => {
  const stats = await pack("kinds", { diagnosticOptions }).runAsync();

  return stats.compilation.errors.map(({ message }) => message).join("\n");
};

describe("diagnostic options", () => {
  it("should report every kind when none is turned off", async () => {
    const messages = await reported(undefined);

    assert.match(messages, /TS1109/u);
    assert.match(messages, /TS2322/u);
  });

  it("should leave out the syntactic ones", async () => {
    const messages = await reported({ syntactic: false });

    assert.doesNotMatch(messages, /TS1109/u);
    assert.match(messages, /TS2322/u);
  });

  it("should leave out the semantic ones", async () => {
    const messages = await reported({ semantic: false });

    assert.match(messages, /TS1109/u);
    assert.doesNotMatch(messages, /TS2322/u);
  });

  it("should report nothing of a program with every kind turned off", async () => {
    const stats = await pack("kinds", {
      diagnosticOptions: {
        declaration: false,
        global: false,
        semantic: false,
        syntactic: false,
      },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report what the config file itself is wrong about either way", async () => {
    const stats = await pack("kinds", {
      // The config file names an option TypeScript does not have.
      configFile: join(
        import.meta.dirname,
        "fixtures",
        "kinds",
        "tsconfig.unknown-option.json",
      ),
      diagnosticOptions: {
        declaration: false,
        global: false,
        semantic: false,
        syntactic: false,
      },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /TS5023/u);
  });
});
