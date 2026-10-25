import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  checkNative,
  loadNative,
  startNative,
  stopNative,
} from "../../src/checks/typescript-native.js";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);
// TypeScript 7, installed beside the TypeScript the rest of the suite runs on.
const typescriptPath = dirname(require.resolve("typescript7/package.json"));

const fixture = join(import.meta.dirname, "fixtures", "native-watch");
const checked = join(fixture, "checked.ts");
const configFile = join(fixture, "tsconfig.json");
const trigger = join(fixture, "trigger.js");
// Outside anything webpack watches for the build itself.
const base = join(
  mkdtempSync(join(tmpdir(), "typescript-7-base-")),
  "tsconfig.json",
);

describe("typescript 7", () => {
  let watch;

  afterEach(() => {
    if (watch) watch.close();

    rmSync(checked, { force: true });
    rmSync(configFile, { force: true });
    rmSync(trigger, { force: true });
    rmSync(base, { force: true });
  });

  it("should load the native API only for TypeScript 7 and later", async () => {
    assert.ok(await loadNative(typescriptPath));
    assert.strictEqual(await loadNative("typescript"), undefined);
    // A path to a module rather than to a package.
    assert.strictEqual(
      await loadNative(join(import.meta.dirname, "mock/typescript-recorder")),
      undefined,
    );
  });

  it("should give compilers sharing the process one run at a time", async () => {
    const context = join(import.meta.dirname, "fixtures", "good");
    const options = { context };
    const native = startNative(await loadNative(typescriptPath), options);
    /** @type {string[]} */
    const order = [];
    /**
     * @param {(change: unknown) => Promise<EXPECTED_ANY>} take what takes a snapshot
     * @returns {(change: unknown) => Promise<EXPECTED_ANY>} it, writing down when
     */
    const noted = (take) => async (change) => {
      order.push("start");

      const taken = await take(change);

      order.push("taken");
      taken.update = noted(taken.update.bind(taken));

      return taken;
    };

    native.api.createSnapshot = noted(
      native.api.createSnapshot.bind(native.api),
    );

    try {
      const [first, second] = await Promise.all([
        checkNative(native, options, {}),
        checkNative(native, options, { modifiedFiles: new Set() }),
      ]);

      assert.deepStrictEqual(first.diagnostics, []);
      assert.deepStrictEqual(second.diagnostics, []);
      // The second run takes its snapshot once the first is done with its own.
      assert.deepStrictEqual(order, ["start", "taken", "start", "taken"]);
    } finally {
      await stopNative(native);
    }
  });

  it("should report nothing when the types are right", async () => {
    const stats = await pack("good", { typescriptPath }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
    assert.strictEqual(stats.hasWarnings(), false);
  });

  it("should report a type error as a webpack error", async () => {
    const stats = await pack("bad", { typescriptPath }).runAsync();
    const [{ message }] = stats.compilation.errors;

    const plain = message.replaceAll(/\u001B\[\d+m/gu, "");

    assert.match(message, /\[typescript\]/u);
    assert.match(plain, /used\.ts:1:14 - error TS2322:/u);
    assert.match(message, /TS2322/u);
    // A file nothing imports is checked too.
    assert.match(message, /orphan\.ts/u);
    // With the line it is on, as `tsc` prints it.
    assert.match(message, /export const wrong: number = "not a number";/u);
  });

  it("should leave out the diagnostics whose code is ignored", async () => {
    const stats = await pack("ignored", {
      typescriptPath,
      ignoreDiagnostics: [2322],
    }).runAsync();
    const [{ message }] = stats.compilation.errors;

    assert.doesNotMatch(message, /TS2322/u);
    assert.match(message, /TS2307/u);
  });

  it("should leave out a kind of diagnostic turned off", async () => {
    const stats = await pack("bad", {
      typescriptPath,
      diagnosticOptions: { semantic: false },
    }).runAsync();

    assert.strictEqual(stats.hasErrors(), false);
  });

  it("should format with a formatter written in the configuration", async () => {
    const stats = await pack("bad", {
      typescriptPath,
      formatter: (/** @type {EXPECTED_ANY[]} */ results) =>
        results.map((one) => `${one.code} ${one.severity}`).join("|"),
    }).runAsync();

    assert.strictEqual(
      stats.compilation.errors[0].message,
      "[typescript] TS2322 error|TS2322 error",
    );
  });

  it("should say what it cannot do rather than ignore it", async () => {
    for (const [options, named] of [
      [{ build: true }, /`build`/u],
      [{ mode: "write-dts" }, /`mode: "write-dts"`/u],
      [{ compilerOptions: { strict: false } }, /`strict`/u],
    ]) {
      const stats = await pack("bad", {
        typescriptPath,
        ...options,
      }).runAsync();
      const [{ message }] = stats.compilation.errors;

      assert.match(message, /TypeScript 7/u);
      assert.match(message, named);
    }
  });

  it("should say a TypeScript with no API to check with has none", async () => {
    for (const threads of [false, "auto"]) {
      const stats = await pack("good", {
        typescriptPath: join(
          import.meta.dirname,
          "mock/typescript-version-only",
        ),
        threads,
      }).runAsync();

      assert.match(
        stats.compilation.errors[0].message,
        /TypeScript 7\.0\.2 offers no compiler API to check with/u,
      );
    }
  });

  it("should say there is no config file to read", async () => {
    // Outside this repository, whose own config file the search would find.
    const context = mkdtempSync(join(tmpdir(), "typescript-7-"));

    writeFileSync(join(context, "index.js"), "export default 1;\n");
    writeFileSync(join(context, "checked.ts"), "export const fine = 1;\n");

    const stats = await pack(
      "good",
      { typescriptPath },
      { context, output: { path: join(context, "dist") } },
    ).runAsync();

    assert.match(
      stats.compilation.errors[0].message,
      /no 'tsconfig\.json' was found above/u,
    );
  });

  it("should check again what a rebuild changed", (t, done) => {
    writeFileSync(
      configFile,
      `${JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true },
        include: ["*.ts"],
      })}\n`,
    );
    writeFileSync(trigger, "export const trigger = 1;\n");
    writeFileSync(checked, "export const wrong: string = 42;\n");

    let fixed = false;

    watch = pack("native-watch", { typescriptPath }).watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (!fixed) {
        // A rebuild webpack starts for what was written before it watched.
        if (!stats.hasErrors()) return;

        assert.match(stats.compilation.errors[0].message, /TS2322/u);
        fixed = true;
        writeFileSync(checked, "export const right: string = '42';\n");

        return;
      }

      if (stats.hasErrors()) return;

      done();
    });
  });

  it(
    "should check again once a config file it extends changes",
    { timeout: 20000 },
    (t, done) => {
      writeFileSync(
        base,
        `${JSON.stringify({ compilerOptions: { noImplicitAny: false } })}\n`,
      );
      writeFileSync(
        configFile,
        `${JSON.stringify({
          extends: base,
          compilerOptions: { skipLibCheck: true },
          include: ["*.ts"],
        })}\n`,
      );
      writeFileSync(trigger, "export const trigger = 1;\n");
      // Fine until `noImplicitAny`, which TypeScript 7 turns on by default, is.
      writeFileSync(
        checked,
        "export function same(value) {\n  return value;\n}\n",
      );

      let strict = false;

      // Webpack reads a config file and what it extends to resolve with, and
      // watches them for that; turned off, only the check can watch them.
      watch = pack(
        "native-watch",
        { typescriptPath },
        { resolve: { tsconfig: false } },
      ).watch({}, (err, stats) => {
        assert.strictEqual(err, null);

        if (!strict) {
          if (stats.hasErrors()) return;

          strict = true;
          // Once the rebuilds webpack starts for what was written before it
          // watched are over, so that only the watch on this file can start one.
          setTimeout(() => {
            writeFileSync(
              base,
              `${JSON.stringify({ compilerOptions: { noImplicitAny: true } })}\n`,
            );
          }, 1000);

          return;
        }

        if (!stats.hasErrors()) return;

        assert.match(stats.compilation.errors[0].message, /TS7006/u);
        done();
      });
    },
  );
});
