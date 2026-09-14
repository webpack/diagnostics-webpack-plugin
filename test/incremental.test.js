import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);
const eslintPath = join(import.meta.dirname, "mock/eslint-recorder");
const entry = join(import.meta.dirname, "fixtures", "watch-entry.js");
const leaf = join(import.meta.dirname, "fixtures", "watch-leaf.js");
const linted = () => require(eslintPath)._calls.flat();

describe("incremental", () => {
  let watch;

  afterEach(() => {
    if (watch) watch.close();
    rmSync(entry, { force: true });
    rmSync(leaf, { force: true });
  });

  it("should lint only what webpack rebuilt", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();

    // eslint-disable-next-line no-use-before-define
    let next = firstPass;
    const compiler = pack("watch", { eslintPath });

    watch = compiler.watch({}, (err, stats) => next(err, stats));

    function secondPass(err) {
      assert.strictEqual(err, null);

      const files = linted();

      assert.strictEqual(files.length, 1);
      assert.match(files[0], /watch-leaf\.js/u);
      done();
    }

    function firstPass(err) {
      assert.strictEqual(err, null);

      const files = linted();

      assert.strictEqual(files.length, 2);
      require(eslintPath)._reset();
      next = secondPass;
      writeFileSync(leaf, "const leaf = 2;\n");
    }
  });

  it("should lint every file again where a rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();
    // Typed linting: what is reported of one file can turn on another, so a
    // file that did not change is not one whose last result still holds.
    require(eslintPath)._readAcrossFiles(true);

    // eslint-disable-next-line no-use-before-define
    let next = firstPass;
    const compiler = pack("watch", { eslintPath });

    watch = compiler.watch({}, (err, stats) => next(err, stats));

    function secondPass(err) {
      assert.strictEqual(err, null);

      const files = linted();

      assert.strictEqual(files.length, 2, "both were linted again");
      assert.ok(files.some((file) => /watch-entry\.js/u.test(file)));
      assert.ok(files.some((file) => /watch-leaf\.js/u.test(file)));
      done();
    }

    function firstPass(err) {
      assert.strictEqual(err, null);
      assert.strictEqual(linted().length, 2);

      require(eslintPath)._reset();
      require(eslintPath)._readAcrossFiles(true);
      next = secondPass;
      writeFileSync(leaf, "const leaf = 2;\n");
    }
  });

  it("should stop reporting a file that leaves the graph", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");

    // eslint-disable-next-line no-use-before-define
    let next = firstPass;
    const compiler = pack("watch");

    watch = compiler.watch({}, (err, stats) => next(err, stats));

    function secondPass(err, stats) {
      assert.strictEqual(err, null);

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /watch-entry\.js/u);
      assert.doesNotMatch(message, /watch-leaf\.js/u);
      done();
    }

    function firstPass(err, stats) {
      assert.strictEqual(err, null);

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /watch-leaf\.js/u);
      next = secondPass;
      writeFileSync(entry, "const entry = 1;\n");
    }
  });
});
