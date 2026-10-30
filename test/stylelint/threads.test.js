import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { lintFiles, setup } from "../../src/checks/stylelint-worker.js";
import { getLoadedStylelint } from "../../src/checks/stylelint.js";
import { toPosixPath } from "../../src/utils.js";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);

describe("Threading", () => {
  it("should don't throw error if file is ok with threads", async () => {
    const compiler = pack("good", { threads: 2 });
    const stats = await compiler.runAsync();
    assert.strictEqual(stats.hasWarnings(), false);
    assert.strictEqual(stats.hasErrors(), false);
  });

  it("threaded interface should look like non-threaded interface", async () => {
    const single = getLoadedStylelint("single", {});
    const threaded = getLoadedStylelint("threaded", { threads: 2 });
    for (const key of Object.keys(single)) {
      assert.deepStrictEqual(typeof single[key], typeof threaded[key]);
    }

    assert.notStrictEqual(single.lintFiles, threaded.lintFiles);
    assert.notStrictEqual(single.cleanup, threaded.cleanup);

    single.cleanup();
    threaded.cleanup();
  });

  it("threaded should lint files", async () => {
    const threaded = getLoadedStylelint("bar", { threads: true });
    try {
      const [good, bad] = await Promise.all([
        threaded.lintFiles(
          toPosixPath(join(import.meta.dirname, "fixtures/good/test.scss")),
        ),
        threaded.lintFiles(
          toPosixPath(join(import.meta.dirname, "fixtures/error/test.scss")),
        ),
      ]);
      assert.strictEqual(good[0].errored, false);
      assert.strictEqual(bad[0].errored, true);
    } finally {
      threaded.cleanup();
    }
  });

  it("should lint a small batch on webpack's thread and a big one over the pool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stylelint-pool-"));
    const small = toPosixPath(join(dir, "small.scss"));
    const big = toPosixPath(join(dir, "big.scss"));
    const stylelintPath = join(import.meta.dirname, "mock/stylelint-recorder");

    // What the recorder saw on this thread: a batch the pool lints is recorded
    // in the worker's copy of it instead.
    const mock = require(stylelintPath);

    writeFileSync(small, "a { color: red; }\n");
    writeFileSync(big, `/* ${"x".repeat(3 * 1024 * 1024)} */\n`);
    mock._reset();

    const threaded = getLoadedStylelint("sized", { threads: 2, stylelintPath });

    try {
      await threaded.lintFiles([small, join(dir, "gone.scss")]);

      assert.strictEqual(mock._calls.length, 1);

      await threaded.lintFiles([big]);

      assert.strictEqual(mock._calls.length, 1);
    } finally {
      await threaded.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should bring back what the pool found in a big batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stylelint-pool-"));
    const big = toPosixPath(join(dir, "big.scss"));

    writeFileSync(big, `/* ${"x".repeat(3 * 1024 * 1024)} */\na { }\n`);

    const threaded = getLoadedStylelint("pooled-results", {
      threads: 2,
      config: { rules: { "block-no-empty": true } },
    });

    try {
      const [result] = await threaded.lintFiles([big]);

      assert.strictEqual(result.errored, true);
      assert.strictEqual(result.warnings[0].rule, "block-no-empty");
    } finally {
      await threaded.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should lint a big batch on webpack's thread when its options cannot reach a worker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stylelint-pool-"));
    const big = toPosixPath(join(dir, "big.scss"));
    const stylelintPath = join(import.meta.dirname, "mock/stylelint-recorder");

    const mock = require(stylelintPath);

    writeFileSync(big, `/* ${"x".repeat(3 * 1024 * 1024)} */\n`);
    mock._reset();

    // A function is not something a worker can be handed.
    const threaded = getLoadedStylelint("with-function", {
      threads: 2,
      stylelintPath,
      formatter: () => "",
    });

    try {
      await threaded.lintFiles([big]);

      assert.strictEqual(mock._calls.length, 1);
    } finally {
      await threaded.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("worker coverage", () => {
    it("worker can start", async () => {
      const mockStylelintPath = join(
        import.meta.dirname,
        "mock/stylelint-recorder",
      );

      // Clear any previous calls
      const mock = require(mockStylelintPath);

      mock._reset();

      // `setup` resets the path and the cached stylelint, so the module state
      // another test left behind does not carry into this one.
      setup({ stylelintPath: mockStylelintPath });

      await lintFiles("foo");

      const [call] = mock._calls;

      assert.strictEqual(call.files, "foo");
      assert.strictEqual(call.quietDeprecationWarnings, true);
    });
  });
});
