import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  affectedFiles,
  createGraph,
  getGraph,
  signatures,
} from "../src/import-graph.js";
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

  describe("what a changed file shows the files importing it", () => {
    // Asked twice: what a file showed is known from its first change on.
    const twice = (name, first, second) => {
      write(name, first);
      affected(all, [name]);
      write(name, second);

      return affected(all, [name]);
    };

    it("should leave its importers be once only its body or comments change", () => {
      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          "// a note\nexport const leaf: number = 3;\n",
        ),
        ["leaf.ts"],
      );
    });

    it("should reach its importers once a type it exports changes", () => {
      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          'export const leaf: string = "2";\n',
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
    });

    it("should reach its importers once what it imports changes", () => {
      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          'import "./alone";\nexport const leaf: number = 2;\n',
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
    });

    it("should reach its importers where its exports do not say their own types", () => {
      // What it returns takes a type checker to say, which the declaration
      // read without one writes as `any` for both.
      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export function make() { return [1].map((x) => x); }\n",
          'export function make() { return ["1"].map((x) => x); }\n',
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
    });

    it("should read what a project's own emit drops, which an importer's rules still see", () => {
      write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            strict: true,
            moduleResolution: "bundler",
            removeComments: true,
            stripInternal: true,
          },
        }),
      );

      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          "/** @deprecated */\nexport const leaf: number = 2;\n",
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          "export const leaf: number = 2;\n/** @internal */\nexport const hidden: number = 1;\n",
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
    });

    it("should reach its importers with a TypeScript that cannot say what a file shows", () => {
      graph = createGraph({ ...ts, transpileDeclaration: undefined });

      assert.deepStrictEqual(
        twice(
          "leaf.ts",
          "export const leaf: number = 2;\n",
          "// a note\nexport const leaf: number = 2;\n",
        ),
        ["leaf.ts", "middle.ts", "top.ts"],
      );
    });

    it("should reach the importers of a file that has gone", () => {
      affected(all, ["leaf.ts"]);
      rmSync(at("leaf.ts"));

      assert.deepStrictEqual(affected(all, ["leaf.ts"]), [
        "leaf.ts",
        "middle.ts",
        "top.ts",
      ]);
    });

    it("should reach the importers of a quiet file that a loud change reaches", () => {
      write(
        "middle.ts",
        'import { leaf } from "./leaf";\nexport const m: number = leaf;\n',
      );
      affected(all, ["middle.ts"]);
      write(
        "middle.ts",
        'import { leaf } from "./leaf";\nexport const m: number = leaf + 0;\n',
      );
      write("leaf.ts", 'export const leaf: string = "1";\n');

      // The middle file says the same, but through it the leaf's new type
      // reaches the top.
      assert.deepStrictEqual(affected(all, ["middle.ts", "leaf.ts"]), [
        "leaf.ts",
        "middle.ts",
        "top.ts",
      ]);
    });
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
  it("should be read with the project's own TypeScript, once per check", async () => {
    const compiler = {};
    const first = getGraph(compiler, import.meta.dirname, "eslint");

    assert.strictEqual(
      getGraph(compiler, import.meta.dirname, "eslint"),
      first,
    );
    assert.ok(await first);
    assert.notStrictEqual(getGraph({}, import.meta.dirname, "eslint"), first);
  });

  it("should not let one check's question change another's answer", async (t) => {
    // Asking changes a graph: two checks of one project each keep their own,
    // or the first to see a config change would empty it under the second.
    // Under the fixtures, so that its TypeScript is this package's.
    const project = mkdtempSync(join(import.meta.dirname, "fixtures", "two-"));

    t.after(() => rmSync(project, { recursive: true, force: true }));
    writeFileSync(join(project, "tsconfig.json"), "{}");
    writeFileSync(join(project, "leaf.ts"), "export const leaf = 1;\n");
    writeFileSync(
      join(project, "top.ts"),
      'import { leaf } from "./leaf";\nexport const top = leaf;\n',
    );

    const compiler = {};
    const config = join(project, "tsconfig.json");
    const sources = [join(project, "leaf.ts"), join(project, "top.ts")];
    // Biome lints JSON, so the config file can be one of its own.
    const both = { eslint: sources, biome: [...sources, config] };
    const [eslint, biome] = await Promise.all([
      getGraph(compiler, project, "eslint"),
      getGraph(compiler, project, "biome"),
    ]);

    assert.notStrictEqual(eslint, biome);

    // Both have read the project, so both know its config file.
    affectedFiles(eslint, both.eslint, [join(project, "leaf.ts")]);
    affectedFiles(biome, both.biome, [join(project, "leaf.ts")]);

    // A config change reaches every file, for the second check to ask as much
    // as for the first.
    assert.strictEqual(affectedFiles(eslint, both.eslint, [config]), undefined);
    assert.strictEqual(affectedFiles(biome, both.biome, [config]), undefined);
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

describe("signatures", () => {
  let dir;
  let graph;
  const at = (name) => join(dir, name);
  const names = ["leaf.ts", "middle.ts", "top.ts", "alone.ts"];
  // A write in the same millisecond as the last one is still a write.
  let tick = Date.now() - 60_000;
  const write = (name, text) => {
    writeFileSync(at(name), text);
    tick += 1000;
    utimesSync(at(name), new Date(tick), new Date(tick));
  };
  const sign = () => {
    const found = signatures(graph, names.map(at));

    return Object.fromEntries(
      names.map((name) => [name, found.get(toPosixPath(at(name)))]),
    );
  };
  const changed = (before, after) =>
    names.filter((name) => before[name] !== after[name]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "signatures-"));
    graph = createGraph(ts);
    write("tsconfig.json", '{ "compilerOptions": { "strict": true } }');
    write("leaf.ts", "export const leaf = 1;\n");
    write(
      "middle.ts",
      'import { leaf } from "./leaf";\nexport const m = leaf;\n',
    );
    write("top.ts", 'import { m } from "./middle";\nexport const t = m;\n');
    write("alone.ts", "export const alone = 1;\n");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("should be the same while nothing changes", () => {
    assert.deepStrictEqual(sign(), sign());
  });

  it("should change for every file importing a changed one, however indirectly", () => {
    const before = sign();

    write("leaf.ts", "export const leaf = 2;\n");

    assert.deepStrictEqual(changed(before, sign()), [
      "leaf.ts",
      "middle.ts",
      "top.ts",
    ]);
  });

  it("should change for every file importing one that has gone", () => {
    const before = sign();

    rmSync(at("leaf.ts"));

    const after = sign();

    assert.notStrictEqual(after["middle.ts"], before["middle.ts"]);
    assert.notStrictEqual(after["top.ts"], before["top.ts"]);
    assert.strictEqual(after["alone.ts"], before["alone.ts"]);
  });

  it("should change for a file importing a package once the package changes", () => {
    mkdirSync(at("node_modules/pkg"), { recursive: true });
    write(
      "node_modules/pkg/package.json",
      '{ "name": "pkg", "types": "index.d.ts" }',
    );
    write("node_modules/pkg/index.d.ts", "export declare const p: number;\n");
    write("alone.ts", 'import { p } from "pkg";\nexport const alone = p;\n');

    const before = sign();

    assert.deepStrictEqual(changed(before, sign()), []);

    write("node_modules/pkg/index.d.ts", "export declare const p: string;\n");

    assert.deepStrictEqual(changed(before, sign()), ["alone.ts"]);
  });

  it("should change for a file that changed, and nothing it imports", () => {
    const before = sign();

    write("top.ts", 'import { m } from "./middle";\nexport const t = 2;\n');

    assert.deepStrictEqual(changed(before, sign()), ["top.ts"]);
  });

  it("should change for every file when the config file does", () => {
    const before = sign();

    write("tsconfig.json", '{ "compilerOptions": { "strict": false } }');

    assert.deepStrictEqual(changed(before, sign()), names);
  });

  it("should change for every file when a declaration file appears or changes", () => {
    const before = sign();

    write("globals.d.ts", "declare const shared: number;\n");

    const added = sign();

    assert.deepStrictEqual(changed(before, added), names);

    write("globals.d.ts", "declare const shared: string;\n");

    assert.deepStrictEqual(changed(added, sign()), names);
  });

  it("should change for every file when one declares something global", () => {
    const before = sign();

    write(
      "alone.ts",
      "declare global { const g: number }\nexport const alone = 1;\n",
    );

    assert.deepStrictEqual(changed(before, sign()), names);
  });

  it("should follow where an import resolves once the config file moves it", () => {
    mkdirSync(at("a"));
    mkdirSync(at("b"));
    write(
      "tsconfig.json",
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@x": ["a/x.ts"] } } }',
    );
    write("a/x.ts", "export const x = 1;\n");
    write("b/x.ts", "export const x = 2;\n");
    write("leaf.ts", 'import { x } from "@x";\nexport const leaf = x;\n');
    sign();
    write(
      "tsconfig.json",
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@x": ["b/x.ts"] } } }',
    );

    const moved = sign();

    // Read under the config as it is now, `@x` is `b/x.ts`.
    write("b/x.ts", "export const x = 3;\n");

    assert.ok(changed(moved, sign()).includes("leaf.ts"));
  });

  it("should change once an import that resolved to nothing does", () => {
    write(
      "alone.ts",
      'import { later } from "./later";\nexport const a = later;\n',
    );

    const before = sign();

    write("later.ts", "export const later = 1;\n");

    assert.ok(changed(before, sign()).includes("alone.ts"));
  });
});
