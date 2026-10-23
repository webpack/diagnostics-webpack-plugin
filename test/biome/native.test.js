import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { findNative } from "../../src/checks/biome.js";

const require = createRequire(import.meta.url);
const launcher = join(
  require.resolve("@biomejs/biome/package.json"),
  "..",
  "bin",
  "biome",
);

describe("biome binary", () => {
  afterEach(() => {
    delete process.env.BIOME_BINARY;
  });

  it("should run the build published for this platform rather than its launcher", () => {
    const found = /** @type {string} */ (findNative(launcher));

    assert.ok(existsSync(found), found);
    assert.match(basename(found), /^biome(?:\.exe)?$/u);
    assert.match(found, /@biomejs[\\/]cli-/u);
  });

  it("should run what BIOME_BINARY names, as the launcher does", () => {
    process.env.BIOME_BINARY = "/opt/biome";

    assert.strictEqual(findNative(launcher), "/opt/biome");
  });

  it("should leave a launcher with no build beside it to run itself", () => {
    const alone = mkdtempSync(join(tmpdir(), "biome-alone-"));

    try {
      const script = join(alone, "biome");

      writeFileSync(script, "");

      assert.strictEqual(findNative(script), undefined);
    } finally {
      rmSync(alone, { recursive: true, force: true });
    }
  });
});
