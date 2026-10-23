import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { openStore, saveStore } from "../src/result-store.js";

describe("result store", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "result-store-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const pathIn = () => join(dir, randomUUID(), "results.json");

  it("should start empty when nothing was written", () => {
    assert.strictEqual(openStore(pathIn()).entries.size, 0);
  });

  it("should give the same store for the same file", () => {
    const path = pathIn();

    assert.strictEqual(openStore(path), openStore(path));
  });

  it("should write only what changed, without the files that have gone", () => {
    const path = pathIn();
    const kept = join(dir, "kept.js");

    writeFileSync(kept, "");

    const store = openStore(path);

    saveStore(store);
    assert.throws(() => readFileSync(path));

    store.entries.set(kept, { key: "a", result: 1 });
    store.entries.set(join(dir, "gone.js"), { key: "b", result: 2 });
    store.dirty = true;
    saveStore(store);

    const written = JSON.parse(readFileSync(path, "utf8"));

    assert.deepStrictEqual(Object.keys(written.entries), [kept]);
    assert.strictEqual(store.dirty, false);
  });

  it("should read as empty a store written in another shape", () => {
    const path = join(dir, "old.json");

    writeFileSync(path, JSON.stringify({ version: 0, entries: { a: {} } }));
    assert.strictEqual(openStore(path).entries.size, 0);

    const broken = join(dir, "broken.json");

    writeFileSync(broken, "{");
    assert.strictEqual(openStore(broken).entries.size, 0);
  });

  it("should not throw when it cannot be written", () => {
    const blocker = join(dir, "file");

    writeFileSync(blocker, "");

    const store = openStore(join(blocker, "results.json"));

    store.entries.set(blocker, { key: "a", result: 1 });
    store.dirty = true;
    assert.doesNotThrow(() => saveStore(store));
    assert.strictEqual(store.dirty, true);
  });
});
