import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);
const typescriptPath = join(import.meta.dirname, "mock/typescript-recorder");

const fixture = join(import.meta.dirname, "fixtures", "watch");
const orphan = join(fixture, "orphan.ts");
const dependency = join(fixture, "dependency.ts");
const dependent = join(fixture, "dependent.ts");
const configFile = join(fixture, "tsconfig.json");
// Something webpack does build, so that a rebuild can be asked for without
// touching the files under test.
const trigger = join(fixture, "trigger.js");

/**
 * @param {boolean} strict whether the project is checked strictly
 */
function writeConfig(strict) {
  writeFileSync(
    configFile,
    `${JSON.stringify(
      {
        compilerOptions: {
          strict,
          target: "es2022",
          module: "preserve",
          skipLibCheck: true,
        },
        include: ["*.ts"],
      },
      null,
      2,
    )}\n`,
  );
}

// Webpack starts a rebuild of its own for a file these tests wrote just before
// the watch began, so each one waits for the state it is after rather than
// counting the passes up to it. A state that never arrives ends as a timeout.
describe("watch", () => {
  let watch;

  afterEach(() => {
    if (watch) {
      watch.close();
    }
    rmSync(orphan, { force: true });
    rmSync(dependency, { force: true });
    rmSync(dependent, { force: true });
    rmSync(configFile, { force: true });
    rmSync(trigger, { force: true });
  });

  it("should rebuild when a file only the program holds changes", (t, done) => {
    writeConfig(true);
    writeFileSync(trigger, "export const trigger = 1;\n");
    writeFileSync(orphan, "export const wrong: string = 42;\n");

    const compiler = pack("watch");
    let fixing = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (fixing) {
        const [{ message }] = stats.compilation.errors;

        assert.match(message, /orphan\.ts/u);
        assert.match(message, /TS2322/u);

        fixing = false;
        writeFileSync(orphan, "export const wrong: number = 42;\n");

        return;
      }

      if (stats.hasErrors()) return;

      done();
    });
  });

  it("should report a file that only a changed dependency breaks", (t, done) => {
    writeConfig(true);
    writeFileSync(trigger, "export const trigger = 1;\n");
    writeFileSync(dependency, "export const shared = 1;\n");
    writeFileSync(
      dependent,
      'import { shared } from "./dependency.js";\n\nexport const doubled: number = shared * 2;\n',
    );

    const compiler = pack("watch", { typescriptPath });
    let breaking = true;

    require(typescriptPath)._reset();

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (breaking) {
        assert.strictEqual(stats.hasErrors(), false);

        breaking = false;
        // Nothing is wrong with this file; what it exports breaks the other.
        writeFileSync(dependency, 'export const shared = "one";\n');

        return;
      }

      if (!stats.hasErrors()) return;

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /dependent\.ts/u);
      assert.doesNotMatch(message, /dependency\.ts/u);

      // The second program was built on the first rather than from nothing.
      assert.deepStrictEqual(require(typescriptPath)._programs.slice(0, 2), [
        false,
        true,
      ]);
      done();
    });
  });

  it("should find a file the config file covers that appears", (t, done) => {
    writeConfig(true);
    writeFileSync(trigger, "export const trigger = 1;\n");

    const compiler = pack("watch");
    let creating = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (creating) {
        assert.strictEqual(stats.hasErrors(), false);

        creating = false;
        // Nothing webpack built is touched: the rebuild is the watcher
        // answering for what the config file's `include` covers.
        writeFileSync(orphan, "export const wrong: string = 42;\n");

        return;
      }

      if (!stats.hasErrors()) return;

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /orphan\.ts/u);
      assert.match(message, /TS2322/u);
      done();
    });
  });

  it("should watch for the file an import resolves to nothing", (t, done) => {
    writeConfig(true);
    writeFileSync(trigger, "export const trigger = 1;\n");
    writeFileSync(
      dependent,
      'import { shared } from "./dependency.js";\n\nexport const doubled: number = shared * 2;\n',
    );

    const compiler = pack("watch");
    let creating = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (creating) {
        const [{ message }] = stats.compilation.errors;

        assert.match(message, /TS2307/u);
        // The file the author goes on to write is one of the paths the
        // resolver tried, so webpack is told to watch for it.
        assert.ok(
          [...stats.compilation.missingDependencies].includes(dependency),
          "the path the import resolved to nothing through is watched",
        );

        creating = false;
        writeFileSync(dependency, "export const shared = 1;\n");

        return;
      }

      if (stats.hasErrors()) return;

      done();
    });
  });

  it("should rebuild when the config file changes", (t, done) => {
    writeConfig(false);
    writeFileSync(trigger, "export const trigger = 1;\n");
    writeFileSync(orphan, "export const same = (value) => value;\n");

    const compiler = pack("watch");
    let tightening = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (tightening) {
        assert.strictEqual(stats.hasErrors(), false);

        tightening = false;
        writeConfig(true);

        return;
      }

      if (!stats.hasErrors()) return;

      const [{ message }] = stats.compilation.errors;

      // The file did not change; what the config file asks of it did.
      assert.match(message, /orphan\.ts/u);
      assert.match(message, /TS7006/u);
      done();
    });
  });
});
