import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { lintFilesWith as eslintWith } from "../src/checks/eslint-worker.js";
import { lintFilesWith as stylelintWith } from "../src/checks/stylelint-worker.js";
import { forRun } from "../src/checks/worker-runs.js";
import { createPool } from "../src/threads.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const eslintEntry = fileURLToPath(
  new URL("../src/checks/eslint-worker.js", import.meta.url),
);
const eslintConfig = join(here, "config-for-tests/eslint.config.mjs");

/**
 * A compiler whose `worker()` runs a call on this thread, recording what it is
 * asked for, as webpack's pool runs it on one of its own.
 * @returns {{ compiler: import("../src/threads.js").ThreadsCompiler, asked: unknown[][], calls: unknown[][] }} the stub and what it saw
 */
function stubCompiler() {
  const asked = [];
  const calls = [];

  return {
    asked,
    calls,
    compiler: {
      worker(path, options) {
        asked.push([path, options]);

        return {
          async run(method, ...args) {
            calls.push([method, ...args]);
            const entry = await import(path);

            return entry[method](...args);
          },
        };
      },
    },
  };
}

describe("webpack's shared threads", () => {
  it("lints through compiler.worker() with numWorkers, one task per file", async () => {
    const { compiler, asked, calls } = stubCompiler();
    const setup = ["eslint", { overrideConfigFile: eslintConfig }, true];
    const pool = createPool(eslintEntry, 3, setup, compiler);

    assert.ok(pool);
    assert.strictEqual(pool.shared, true);
    assert.deepStrictEqual(asked, [[eslintEntry, { numWorkers: 3 }]]);

    const files = [
      join(here, "fixtures/good.js"),
      join(here, "fixtures/error.js"),
    ];
    const results = await pool.lintFiles(files);

    assert.deepStrictEqual(
      results.map((result) => result.filePath),
      files,
    );
    assert.ok(results[1].errorCount > 0);
    assert.strictEqual(calls.length, 2);
    assert.ok(calls.every(([method]) => method === "lintFilesWith"));
    // one run for both files
    assert.strictEqual(calls[0][1], calls[1][1]);
  });

  it("starts a new run on end() and leaves the threads to webpack", async () => {
    const { compiler, calls } = stubCompiler();
    const pool = createPool(
      eslintEntry,
      2,
      ["eslint", { overrideConfigFile: eslintConfig }, true],
      compiler,
    );
    const file = join(here, "fixtures/good.js");

    await pool.lintFiles([file]);
    await pool.end();
    await pool.lintFiles([file]);

    assert.notStrictEqual(calls[0][1], calls[1][1]);
  });

  it("does not hand a setup holding a function to webpack's threads", () => {
    const { compiler, asked } = stubCompiler();

    assert.strictEqual(
      createPool(eslintEntry, 2, [{ formatter: () => "" }], compiler),
      null,
    );
    assert.deepStrictEqual(asked, []);
  });

  it("keeps jest-worker while webpack watches", async () => {
    const { compiler, asked } = stubCompiler();
    const pool = createPool(
      eslintEntry,
      1,
      ["eslint", { overrideConfigFile: eslintConfig }, true],
      { ...compiler, watchMode: true },
    );

    try {
      assert.strictEqual(pool.shared, false);
      assert.deepStrictEqual(asked, []);
    } finally {
      await pool.end();
    }
  });

  it("falls back to jest-worker on a webpack without compiler.worker()", async () => {
    const pool = createPool(
      eslintEntry,
      1,
      ["eslint", { overrideConfigFile: eslintConfig }, true],
      {},
    );

    try {
      assert.strictEqual(pool.shared, false);

      const [result] = await pool.lintFiles([join(here, "fixtures/good.js")]);

      assert.strictEqual(result.errorCount, 0);
    } finally {
      await pool.end();
    }
  });
});

describe("a worker entry's runs", () => {
  it("builds once per run and again for a new one", () => {
    const cache = new Map();
    let built = 0;
    const create = () => ({ built: ++built });

    const first = forRun(cache, 1, ["a"], create);

    assert.strictEqual(forRun(cache, 1, ["a"], create), first);

    const second = forRun(cache, 2, ["a"], create);

    assert.notStrictEqual(second, first);
    assert.strictEqual(built, 2);
  });

  it("keeps one value per setup, the latest run's", () => {
    const cache = new Map();

    for (let run = 1; run <= 10; run++) {
      forRun(cache, run, ["a"], () => `a${run}`);
      forRun(cache, run, ["b"], () => `b${run}`);
    }

    // a run that is over holds nothing; two setups keep one each
    assert.deepStrictEqual(
      [...cache.values()].map(({ value }) => value),
      ["a10", "b10"],
    );
  });

  it("lints with ESLint for a run", async () => {
    const setup = ["eslint", { overrideConfigFile: eslintConfig }, true];
    const [result] = await eslintWith(1e6, setup, [
      join(here, "fixtures/error.js"),
    ]);

    assert.ok(result.errorCount > 0);
  });

  it("lints with Stylelint for a run", async () => {
    const fixtures = join(here, "stylelint/fixtures");
    const setup = [
      {},
      { configFile: join(here, "stylelint/.stylelintrc"), cwd: fixtures },
    ];
    const [result] = await stylelintWith(1e6, setup, [
      join(fixtures, "error/test.scss"),
    ]);

    assert.strictEqual(result.errored, true);
    assert.ok(Array.isArray(result.warnings));
  });
});
