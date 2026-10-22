import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { affectedFiles, createGraph, getGraph } from "../src/import-graph.js";
import { toPosixPath } from "../src/utils.js";

const ts = createRequire(import.meta.url)("typescript");

describe("import graph", () => {
  let dir;
  let graph;
  const at = (name) => join(dir, name);
  const write = (name, text) => writeFileSync(at(name), text);
  const affected = (names, changed) => {
    const found = affectedFiles(graph, names.map(at), changed.map(at));

    return (
      found &&
      [...found]
        .map((file) => file.slice(toPosixPath(dir).length + 1))
        .toSorted()
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "import-graph-"));
    graph = createGraph(ts);
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { strict: true, moduleResolution: "bundler" },
      }),
    );
    write("leaf.ts", "export const leaf = 1;\n");
    write("types.ts", "export interface Shape { id: number }\n");
    write(
      "middle.ts",
      'import { leaf } from "./leaf";\nexport const m = leaf;\n',
    );
    write("top.ts", 'import { m } from "./middle";\nexport const t = m;\n');
    write(
      "typed.ts",
      'import type { Shape } from "./types";\nexport const s: Shape = { id: 1 };\n',
    );
    write("alone.ts", "export const alone = 1;\n");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const all = [
    "leaf.ts",
    "types.ts",
    "middle.ts",
    "top.ts",
    "typed.ts",
    "alone.ts",
  ];

  it("should reach every file importing a changed one, however indirectly", () => {
    assert.deepStrictEqual(affected(all, ["leaf.ts"]), [
      "leaf.ts",
      "middle.ts",
      "top.ts",
    ]);
  });

  it("should follow a type-only import, which a bundler drops", () => {
    assert.deepStrictEqual(affected(all, ["types.ts"]), [
      "typed.ts",
      "types.ts",
    ]);
  });

  it("should follow a triple-slash reference", () => {
    write(
      "alone.ts",
      '/// <reference path="./types.ts" />\nexport const a = 1;\n',
    );

    assert.deepStrictEqual(affected(all, ["types.ts"]), [
      "alone.ts",
      "typed.ts",
      "types.ts",
    ]);
  });

  it("should read a changed file's imports again", () => {
    affected(all, ["alone.ts"]);
    write(
      "alone.ts",
      'import { leaf } from "./leaf";\nexport const a = leaf;\n',
    );
    affected(all, ["alone.ts"]);

    assert.deepStrictEqual(affected(all, ["leaf.ts"]), [
      "alone.ts",
      "leaf.ts",
      "middle.ts",
      "top.ts",
    ]);
  });

  it("should answer for every file when a change reaches them some other way", () => {
    write("globals.d.ts", "declare const shared: number;\n");

    assert.strictEqual(affected(all, ["globals.d.ts"]), undefined);
  });

  it("should answer for every file when one declares something global", () => {
    write("alone.ts", "declare global { const g: number }\nexport {};\n");

    assert.strictEqual(affected(all, ["leaf.ts"]), undefined);
  });

  it("should answer for every file once a config file changes", () => {
    affected(all, ["leaf.ts"]);

    assert.strictEqual(affected(all, ["tsconfig.json"]), undefined);
    assert.strictEqual(graph.files.size, 0);
  });

  it("should answer for every file when a relative import resolves to nothing", () => {
    write(
      "alone.ts",
      'import { gone } from "./gone";\nexport const a = gone;\n',
    );

    assert.strictEqual(affected(all, ["leaf.ts"]), undefined);
  });
});

describe("the graph a compiler keeps", () => {
  it("should be read with the project's own TypeScript, once per project", async () => {
    const compiler = {};
    const first = getGraph(compiler, import.meta.dirname);

    assert.strictEqual(getGraph(compiler, import.meta.dirname), first);
    assert.ok(await first);
    assert.notStrictEqual(getGraph({}, import.meta.dirname), first);
  });

  it("should be nothing for a project whose TypeScript cannot be loaded", async (t) => {
    // Its own `typescript` is found before any installed elsewhere.
    const project = mkdtempSync(join(tmpdir(), "no-typescript-"));
    const broken = join(project, "node_modules", "typescript");

    t.after(() => rmSync(project, { recursive: true, force: true }));
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "package.json"), '{ "main": "index.js" }');
    writeFileSync(join(broken, "index.js"), 'throw new Error("broken");\n');

    assert.strictEqual(await getGraph({}, project), undefined);
  });
});
