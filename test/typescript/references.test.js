import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);
const typescriptPath = join(import.meta.dirname, "mock/typescript-recorder");

const fixture = join(import.meta.dirname, "fixtures", "references");
const library = join(fixture, "lib");
const application = join(fixture, "app");
const broken = join(application, "src", "index.ts");

const clean = () => {
  for (const project of [library, application]) {
    rmSync(join(project, "dist"), { force: true, recursive: true });
    rmSync(join(project, "tsconfig.tsbuildinfo"), { force: true });
  }
};

describe("references", () => {
  let watch;

  afterEach(() => {
    if (watch) {
      watch.close();
      watch = undefined;
    }
    clean();
  });

  it("should report nothing of a solution it is not asked to build", async () => {
    // The config file lists no files of its own, so the program it describes
    // is empty: what the projects hold is reached by building them.
    const stats = await pack("references").runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(existsSync(join(library, "dist")), false);
  });

  it("should report what a built solution finds", async () => {
    const stats = await pack("references", { build: true }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);

    const [{ message }] = stats.compilation.errors;

    assert.match(message, /app[/\\]src[/\\]index\.ts/u);
    assert.match(message, /TS2322/u);
  });

  it("should publish the declarations a referenced project is read through", async () => {
    await pack("references", { build: true }).runAsync();

    // What the next project reads. The JavaScript is webpack's to write, so
    // the build writes none of it.
    assert.strictEqual(
      existsSync(join(library, "dist", "index.d.ts")),
      true,
      "the library's declarations are written",
    );
    assert.strictEqual(
      existsSync(join(library, "dist", "index.js")),
      false,
      "no JavaScript is written",
    );
  });

  it("should watch what a project holds and not what the build writes", async () => {
    const stats = await pack("references", { build: true }).runAsync();
    const { fileDependencies, contextDependencies } = stats.compilation;

    assert.ok(
      [...fileDependencies].includes(join(library, "src", "index.ts")),
      "a file of a referenced project is watched",
    );
    assert.ok(
      [...contextDependencies].includes(join(library, "src")),
      "the folder that project takes its files from is watched",
    );
    // The fixture folder holds both projects' `dist`, so watching it would
    // turn what the build writes into the next build's trigger.
    assert.ok(
      ![...contextDependencies].includes(fixture),
      "no folder the build writes into is watched",
    );
  });

  it("should report a project of the solution it cannot read", async () => {
    const stats = await pack("references", {
      build: true,
      configFile: join(fixture, "tsconfig.missing.json"),
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), true);
    assert.match(stats.compilation.errors[0].message, /nowhere/u);
  });

  it("should stop reporting a solution the change fixes", async () => {
    const source = readFileSync(broken, "utf8");

    try {
      const first = await pack("references", { build: true }).runAsync();

      assert.strictEqual(first.hasErrors(), true);

      writeFileSync(broken, source.replace(": string", ": number"));

      const second = await pack("references", { build: true }).runAsync();

      assert.strictEqual(second.hasErrors(), false);
    } finally {
      writeFileSync(broken, source);
    }
  });

  it("should build each project of a rebuilt solution on the one before it", (t, done) => {
    const source = readFileSync(broken, "utf8");

    t.after(() => {
      writeFileSync(broken, source);
    });

    require(typescriptPath)._reset();

    const compiler = pack("references", { build: true, typescriptPath });
    let fixing = true;
    let built = 0;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (fixing) {
        assert.strictEqual(stats.hasErrors(), true);

        fixing = false;
        built = require(typescriptPath)._handedBack.length;
        writeFileSync(broken, source.replace(": string", ": number"));

        return;
      }

      if (stats.hasErrors()) return;

      const { _handedBack: handedBack } = require(typescriptPath);

      // `tsc -b` reads an old program back from `.tsbuildinfo` either way, so
      // what says the last one was kept is that it is the very same object.
      assert.deepStrictEqual(
        handedBack.slice(0, built),
        handedBack.slice(0, built).map(() => false),
        "the first solution built its projects from nothing",
      );
      assert.ok(
        handedBack.slice(built).includes(true),
        "a project of the second solution was handed the program of the first",
      );
      done();
    });
  });
});
