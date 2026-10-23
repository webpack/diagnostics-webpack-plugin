import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

/** @type {string[][]} */
const calls = [];

/**
 * A check that records what it is asked to lint, and says whatever it is
 * told about reading across files.
 * @param {boolean=} reads what its adapter says, or nothing to say nothing
 * @returns {import("../src/checks/index.js").CheckAdapterInput} the adapter
 */
const recorder = (reads) => ({
  name: "recorder",
  resultPath: (/** @type {{ file: string }} */ result) => result.file,
  ...(reads === undefined ? {} : { readsAcrossFiles: () => reads }),
  create: async () => ({
    lintFiles: async (/** @type {string[]} */ files) => {
      calls.push(files);

      return [];
    },
    getResults: async (/** @type {unknown[]} */ results) => results,
    splitResults: () => ({ errors: [], warnings: [] }),
    getFormatter: async () => async () => "",
    cleanup: async () => {},
  }),
});

const linted = () =>
  calls
    .flat()
    .map((file) => file.replace(/^.*[\\/]/u, ""))
    .toSorted();

describe("reading across files", () => {
  /** @type {import("webpack").Watching | undefined} */
  let watching;
  /** @type {string | undefined} */
  let project;

  afterEach(async () => {
    if (watching) {
      await new Promise((resolve) => {
        /** @type {import("webpack").Watching} */ (watching).close(resolve);
      });
    }

    watching = undefined;

    if (project) rmSync(project, { recursive: true, force: true });
  });

  /**
   * A project under the fixtures, so that its TypeScript is this package's,
   * of an entry importing a leaf and another file. What the files say is
   * dated well before the watch starts, or its first rebuild counts them as
   * changed along with the edit.
   * @param {boolean=} brokenTypeScript whether the project's own TypeScript cannot be loaded
   * @returns {string} where it is
   */
  const createProject = (brokenTypeScript = false) => {
    project = mkdtempSync(join(import.meta.dirname, "fixtures", "across-"));
    writeFileSync(join(project, "leaf.js"), "module.exports = 1;\n");
    writeFileSync(join(project, "other.js"), "module.exports = 2;\n");
    writeFileSync(
      join(project, "entry.js"),
      "require('./leaf.js');\nrequire('./other.js');\n",
    );

    if (brokenTypeScript) {
      const broken = join(project, "node_modules", "typescript");

      mkdirSync(broken, { recursive: true });
      writeFileSync(join(broken, "package.json"), '{ "main": "index.js" }');
      writeFileSync(join(broken, "index.js"), 'throw new Error("broken");\n');
    }

    const past = new Date(Date.now() - 60_000);

    for (const name of ["leaf.js", "other.js", "entry.js"]) {
      utimesSync(join(project, name), past, past);
    }

    return project;
  };

  /**
   * Builds, edits the leaf, and hands over what the rebuild linted.
   * @param {import("../src/options.js").CheckEntry} entry the entry of `checks`
   * @param {(files: string[]) => void} check what to say of them
   * @param {() => void} done done
   * @param {boolean=} brokenTypeScript whether the project's own TypeScript cannot be loaded
   */
  const rebuild = (entry, check, done, brokenTypeScript = false) => {
    const context = createProject(brokenTypeScript);
    const compiler = webpack({
      context,
      entry: "./entry.js",
      mode: "development",
      output: { path: join(import.meta.dirname, "outputs") },
      plugins: [new DiagnosticsPlugin({ checks: [entry] })],
    });
    let edits = 0;
    const edit = () => {
      calls.length = 0;
      edits += 1;
      writeFileSync(join(context, "leaf.js"), `module.exports = ${edits};\n`);
    };

    watching = compiler.watch({}, (err) => {
      assert.strictEqual(err, null);

      // A file written just before the watch started can have its time known
      // to webpack only once it has, and the first rebuild then builds that
      // module again too, as macOS does: what the second edit's rebuild lints
      // is what an edit alone makes it lint.
      if (edits < 2) {
        edit();

        return;
      }

      check(linted());
      done();
    });
  };

  it("should lint again what imports a change, for any check that reads across files", (t, done) => {
    rebuild(
      { use: recorder(true) },
      (files) => assert.deepStrictEqual(files, ["entry.js", "leaf.js"]),
      done,
    );
  });

  it("should take readsAcrossFiles written down over what the adapter says", (t, done) => {
    rebuild(
      { use: recorder(true), readsAcrossFiles: false },
      (files) => assert.deepStrictEqual(files, ["leaf.js"]),
      done,
    );
  });

  it("should take readsAcrossFiles written down for an adapter that says nothing", (t, done) => {
    rebuild(
      { use: recorder(), readsAcrossFiles: true },
      (files) => assert.deepStrictEqual(files, ["entry.js", "leaf.js"]),
      done,
    );
  });

  it("should lint every file again without a TypeScript to read imports with", (t, done) => {
    rebuild(
      { use: recorder(true) },
      (files) =>
        assert.deepStrictEqual(files, ["entry.js", "leaf.js", "other.js"]),
      done,
      true,
    );
  });
});
