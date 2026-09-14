import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
const entryPath = join(fixture, "index.js");
// What the fixture says before a test edits it, so that one ending early
// leaves nothing behind.
const pristine = new Map(
  [broken, entryPath].map((file) => [file, readFileSync(file, "utf8")]),
);

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
    for (const [file, content] of pristine) writeFileSync(file, content);
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

  it("should report a change made while the last build was running", (_, done) => {
    const source = readFileSync(broken, "utf8");
    const entry = readFileSync(entryPath, "utf8");

    // The solution starts clean, so the error the second build must report is
    // one this test puts there.
    writeFileSync(broken, source.replace(": string", ": number"));

    const compiler = pack("references", { build: true });
    let editing = true;

    // Long enough that the edit and the file that triggers the rebuild are one
    // change rather than a race between two.
    watch = compiler.watch({ aggregateTimeout: 300 }, (err, stats) => {
      assert.strictEqual(err, null);

      if (editing) {
        assert.strictEqual(stats.hasErrors(), false);

        editing = false;

        // `tsc -b` reads how old an input is next to the outputs of the last
        // build, and an edit made while that build was running is older than
        // what it went on to write. This is that edit, stamped from inside it.
        const during = new Date(
          statSync(join(library, "tsconfig.tsbuildinfo")).mtimeMs - 200,
        );

        writeFileSync(broken, source);
        utimesSync(broken, during, during);
        // Something webpack is sure to notice, since the edit above was stamped
        // into the past for the watcher as well.
        writeFileSync(entryPath, `${entry}\n// rebuild\n`);

        return;
      }

      if (!stats.hasErrors()) return;

      assert.match(stats.compilation.errors[0].message, /TS2322/u);
      done();
    });
  });

  it("should build each project of a rebuilt solution on the one before it", (_, done) => {
    const source = readFileSync(broken, "utf8");

    require(typescriptPath)._reset();

    const compiler = pack("references", {
      build: true,
      threads: false,
      typescriptPath,
    });
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
