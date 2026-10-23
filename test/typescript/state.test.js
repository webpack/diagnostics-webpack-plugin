import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const require = createRequire(import.meta.url);
const typescriptPath = join(import.meta.dirname, "mock/typescript-recorder");
const recorder = () => require(typescriptPath);

describe("the state a program leaves for the next run", () => {
  /** @type {string} */
  let project;
  /** @type {string} */
  let state;

  beforeEach(() => {
    project = mkdtempSync(join(import.meta.dirname, "fixtures", "state-"));
    state = join(project, "state");
    writeFileSync(
      join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true },
        include: ["*.ts"],
      }),
    );
    writeFileSync(join(project, "index.js"), "export const entry = 1;\n");
    writeFileSync(join(project, "dependency.ts"), "export const shared = 1;\n");
    writeFileSync(
      join(project, "dependent.ts"),
      'import { shared } from "./dependency";\n\nexport const doubled: number = shared * 2;\n',
    );
  });

  afterEach(() => rmSync(project, { recursive: true, force: true }));

  // One build as `webpack` on the command line makes it, on webpack's thread
  // so that the recorder sees its programs.
  const run = (options = {}) => {
    recorder()._reset();

    return pack(basename(project), {
      threads: false,
      typescriptPath,
      cacheLocation: state,
      ...options,
    }).runAsync();
  };

  it("should start a later run from what the last one wrote", async () => {
    assert.strictEqual((await run()).hasErrors(), false);
    assert.deepStrictEqual(recorder()._programs, [false]);
    assert.strictEqual(readdirSync(state).length, 1);

    assert.strictEqual((await run()).hasErrors(), false);
    // Read back from the cache rather than built from nothing.
    assert.deepStrictEqual(recorder()._programs, [true]);
  });

  it("should report a file a change made since breaks, though it did not change", async () => {
    await run();

    // Nothing is wrong with this file; what it exports breaks the other.
    writeFileSync(
      join(project, "dependency.ts"),
      'export const shared = "one";\n',
    );

    const stats = await run();
    const [{ message }] = stats.compilation.errors;

    assert.match(message, /dependent\.ts/u);
    assert.match(message, /TS2362/u);
  });

  it("should write nothing with the cache off", async () => {
    await run({ cache: false });
    await run({ cache: false });

    assert.ok(!existsSync(state));
    assert.deepStrictEqual(recorder()._programs, [false]);
  });
});
