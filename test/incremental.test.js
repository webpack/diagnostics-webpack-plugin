import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { countThreads } from "../src/threads.js";

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

  it("should turn the tool's cache off where a rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();
    require(eslintPath)._readAcrossFiles(true);

    // Unset rather than off, which is what the test configuration writes.
    const compiler = pack("watch", { cache: undefined, eslintPath });

    watch = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);

      const built = require(eslintPath)._built;

      // A cache keyed on one file's own contents cannot answer for a rule that
      // read another, so the linter is made again without one.
      assert.strictEqual(built[0].cache, true, "the cache is on by default");
      assert.strictEqual(built.at(-1).cache, false, "and off once typed");
      done();
    });
  });

  it("should keep a cache written down where a rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();
    require(eslintPath)._readAcrossFiles(true);

    const compiler = pack("watch", { cache: true, eslintPath });

    watch = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);

      // Asked for, so the trade of results for speed is the configuration's.
      assert.ok(require(eslintPath)._built.every((one) => one.cache === true));
      done();
    });
  });

  it("should keep the cache on where no rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();

    const compiler = pack("watch", { cache: undefined, eslintPath });

    watch = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);
      assert.ok(require(eslintPath)._built.every((one) => one.cache === true));
      done();
    });
  });

  it("should lint in this thread where a rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();
    require(eslintPath)._setVersion("10.0.0");
    require(eslintPath)._readAcrossFiles(true);

    const compiler = pack("watch", { eslintPath });

    watch = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);

      const built = require(eslintPath)._built;

      // A machine with no thread to spare never asks ESLint to thread at all.
      if (countThreads("auto") <= 1) {
        assert.ok(built.every((one) => one.concurrency === undefined));
        done();
        return;
      }

      // Every thread ESLint starts builds the TypeScript program again, and
      // cold on every rebuild, so typed linting stays where it stays warm.
      assert.strictEqual(built[0].concurrency, "auto");
      assert.strictEqual(built.at(-1).concurrency, "off");
      done();
    });
  });

  it("should keep a concurrency written against ESLint where a rule reads other files", (t, done) => {
    writeFileSync(leaf, "const leaf = 1;\n");
    writeFileSync(entry, "require('./watch-leaf');\nconst entry = 1;\n");
    require(eslintPath)._reset();
    require(eslintPath)._setVersion("10.0.0");
    require(eslintPath)._readAcrossFiles(true);

    const compiler = pack("watch", { concurrency: 2, eslintPath });

    watch = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);

      const built = require(eslintPath)._built;

      assert.ok(built.every((one) => one.concurrency === 2));
      done();
    });
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
