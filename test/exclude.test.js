import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const fixtures = join(import.meta.dirname, "fixtures");
const late = join(fixtures, "late-folder");
const entry = join(fixtures, "late-folder-entry.js");

describe("exclude", () => {
  let watch;

  afterEach(() => {
    if (watch) {
      watch.close();
      watch = undefined;
    }
    rmSync(late, { force: true, recursive: true });
    rmSync(entry, { force: true });
  });

  it("should exclude with globs", async () => {
    const compiler = pack("exclude", { exclude: ["*error*"] });

    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), false);
  });

  it("should exclude files", async () => {
    const compiler = pack("exclude", { exclude: ["error.js"] });

    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), false);
  });

  it("should exclude folders", async () => {
    const compiler = pack("exclude-folder", { exclude: ["folder"] });

    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), false);
  });

  it("should exclude a folder that is not there when the build starts", (t, done) => {
    // The globs are read once, before anything runs, so a folder that a
    // generator or a cleaned output directory leaves for later is not there.
    rmSync(late, { force: true, recursive: true });
    writeFileSync(entry, "const entry = 1;\n\nmodule.exports = entry;\n");

    const compiler = pack("late-folder", { exclude: ["late-folder"] });
    let writing = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);
      assert.strictEqual(
        stats.hasErrors(),
        false,
        "nothing under it is linted",
      );

      if (writing) {
        writing = false;
        mkdirSync(late, { recursive: true });
        writeFileSync(join(late, "error.js"), "var foo = stuff\n");
        writeFileSync(
          entry,
          "require('./late-folder/error');\n\nconst entry = 1;\n\nmodule.exports = entry;\n",
        );

        return;
      }

      done();
    });
  });
});
