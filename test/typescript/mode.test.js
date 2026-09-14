import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

// A fixture of its own: the suite runs its files in parallel, and the
// `references` one cleans the outputs these cases are about.
const fixture = join(import.meta.dirname, "fixtures", "references-mode");
const library = join(fixture, "lib");
const application = join(fixture, "app");
const written = join(import.meta.dirname, "outputs", "mode");

const clean = () => {
  for (const project of [library, application]) {
    rmSync(join(project, "dist"), { force: true, recursive: true });
    rmSync(join(project, "tsconfig.tsbuildinfo"), { force: true });
  }
  rmSync(written, { force: true, recursive: true });
};

describe("mode", () => {
  afterEach(clean);

  it("should write the declarations a built solution is read through", async () => {
    // What `build` does when nothing says otherwise: a project reads the
    // declarations of the one it references, so they are what is written.
    const stats = await pack("references-mode", { build: true }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.strictEqual(existsSync(join(library, "dist", "index.d.ts")), true);
    assert.strictEqual(existsSync(join(library, "dist", "index.js")), false);
  });

  it("should write nothing of a solution it is asked to keep to itself", async () => {
    const stats = await pack("references-mode", {
      build: true,
      mode: "readonly",
    }).runAsync();

    // `tsc -b` refuses `noEmit`, so this says the writes were dropped rather
    // than never made: the solution is still built, and still reports.
    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /TS2322/u);
    assert.strictEqual(existsSync(join(library, "dist")), false);
    assert.strictEqual(
      existsSync(join(library, "tsconfig.tsbuildinfo")),
      false,
    );
  });

  it("should write only what a build is resumed from", async () => {
    await pack("references-mode", {
      build: true,
      mode: "write-tsbuildinfo",
    }).runAsync();

    assert.strictEqual(existsSync(join(library, "tsconfig.tsbuildinfo")), true);
    assert.strictEqual(existsSync(join(library, "dist", "index.d.ts")), false);
  });

  it("should write what the compiler emits where the references are wanted", async () => {
    await pack("references-mode", {
      build: true,
      mode: "write-references",
    }).runAsync();

    assert.strictEqual(existsSync(join(library, "dist", "index.d.ts")), true);
    assert.strictEqual(
      existsSync(join(library, "dist", "index.js")),
      true,
      "the JavaScript a later build would read is written too",
    );
  });

  it("should write the declarations of a program that is not a solution", async () => {
    const stats = await pack("good", {
      mode: "write-dts",
      compilerOptions: { declarationDir: written, outDir: written },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(existsSync(join(written, "ok.d.ts")), true);
    assert.strictEqual(
      existsSync(join(written, "ok.js")),
      false,
      "the JavaScript is still webpack's to write",
    );
  });
});
