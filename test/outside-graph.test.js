import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);

describe("files outside the module graph", () => {
  it("should check only what webpack built when no files are named", async () => {
    const stats = await pack("outside").runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should check a file webpack never built when files are named", async () => {
    const stats = await pack("outside", { files: "outside" }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /orphan\.js/u);
    assert.match(message, /no-unused-vars/u);
  });

  it("should watch the folder it was told to check", async () => {
    const stats = await pack("outside", { files: "outside" }).runAsync();
    const watched = [...stats.compilation.contextDependencies];

    // A check reading the module graph has nothing to say about a file that
    // is not in it; one told where to look is watched there like any other.
    assert.ok(
      watched.includes(join(import.meta.dirname, "fixtures", "outside")),
    );
  });

  it("should still check what webpack built when files are named", async () => {
    const eslintPath = join(import.meta.dirname, "mock/eslint-recorder");

    require(eslintPath)._reset();

    // The walk covers the imported file as well as the orphan, rather than
    // replacing the graph with whatever the graph left out.
    await pack("outside", { eslintPath, files: "outside" }).runAsync();

    const linted = require(eslintPath)._calls.flat().join();

    assert.match(linted, /outside\/good\.js/u);
    assert.match(linted, /outside\/orphan\.js/u);
  });
});
