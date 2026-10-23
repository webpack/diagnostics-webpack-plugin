import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { acquire, keptFor, release } from "../src/compiler-state.js";

/**
 * @returns {EXPECTED_ANY} a compiler with the hooks the state taps
 */
function fakeCompiler() {
  /** @type {(() => Promise<void>)[]} */
  const shutdown = [];
  /** @type {(() => void)[]} */
  const watchClose = [];

  return {
    hooks: {
      shutdown: { tapPromise: (_, fn) => shutdown.push(fn) },
      watchClose: { tap: (_, fn) => watchClose.push(fn) },
    },
    shutdown: () => Promise.all(shutdown.map((fn) => fn())),
    closeWatch: () => {
      for (const fn of watchClose) fn();
    },
    tapped: () => shutdown.length + watchClose.length,
  };
}

describe("compiler state", () => {
  it("should keep one thing per compiler and key", () => {
    const one = fakeCompiler();
    const other = fakeCompiler();
    const made = keptFor(one, "results", () => new Map());

    assert.strictEqual(
      keptFor(one, "results", () => new Map()),
      made,
    );
    assert.notStrictEqual(
      keptFor(other, "results", () => new Map()),
      made,
    );
    assert.notStrictEqual(
      keptFor(one, "graph", () => new Map()),
      made,
    );
  });

  it("should share what compilers acquire under one key, and stop it with the last", async () => {
    const one = fakeCompiler();
    const other = fakeCompiler();
    const stopped = [];
    let started = 0;
    const start = () => ({ id: (started += 1) });
    const stop = (value) => {
      stopped.push(value.id);
    };

    const first = acquire(one, "worker", start, stop);

    assert.strictEqual(acquire(other, "worker", start, stop), first);
    assert.strictEqual(started, 1);

    await one.shutdown();
    assert.deepStrictEqual(stopped, []);

    other.closeWatch();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    assert.deepStrictEqual(stopped, [1]);

    // Gone with its last user, so the next compiler starts a new one.
    assert.deepStrictEqual(acquire(one, "worker", start, stop), { id: 2 });
    await release(one, "worker");
    assert.deepStrictEqual(stopped, [1, 2]);
  });

  it("should tap a compiler once however much it acquires", () => {
    const compiler = fakeCompiler();

    acquire(
      compiler,
      "a",
      () => ({}),
      () => {},
    );
    acquire(
      compiler,
      "b",
      () => ({}),
      () => {},
    );
    acquire(
      compiler,
      "a",
      () => ({}),
      () => {},
    );

    assert.strictEqual(compiler.tapped(), 2);
  });

  it("should hand back nothing and keep nothing when it cannot start", () => {
    const compiler = fakeCompiler();

    assert.strictEqual(
      acquire(
        compiler,
        "none",
        () => null,
        () => {},
      ),
      null,
    );
    assert.deepStrictEqual(
      acquire(
        compiler,
        "none",
        () => ({ started: true }),
        () => {},
      ),
      { started: true },
    );
  });

  it("should do nothing for what a compiler never acquired", async () => {
    await release(fakeCompiler(), "nothing");
  });
});
