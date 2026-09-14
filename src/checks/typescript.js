// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";

import { countThreads, createSolo } from "../threads.js";
import { importFrom } from "../utils.js";

import { check, describe, getHeld, getSchemas } from "./typescript-program.js";

export { getTypeScriptOptions } from "./typescript-program.js";

/** @typedef {import("./index.js").CheckContext} CheckContext */
/** @typedef {import("./index.js").CheckInstance} CheckInstance */
/** @typedef {import("./index.js").Format} Format */
/** @typedef {import("./index.js").FormatterOption} FormatterOption */
/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {import("../threads.js").Solo} Solo */

/** @typedef {EXPECTED_ANY} TypeScript */
/** @typedef {EXPECTED_ANY} Diagnostic */
/**
 * What a worker answers with in place of a diagnostic it cannot hand over.
 * @typedef {{ file?: string, code: string, severity: string, text: string, formatted: string }} Described
 */

const nodeRequire = createRequire(import.meta.url);

/** @type {WeakMap<EXPECTED_ANY, Map<string, Solo>>} */
const workersByCompiler = new WeakMap();

/**
 * @param {EXPECTED_ANY} compiler the compiler the check ran for
 * @param {string} id a key unique to the check within that compiler
 */
function dropWorker(compiler, id) {
  const checks = workersByCompiler.get(compiler);

  if (checks) checks.delete(id);
}

/**
 * The one worker this check runs on, kept for the compiler it runs for so that
 * the program it holds outlives the compilation that built it.
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @param {string} id a key unique to the check within that compiler
 * @param {Options} options the options the check was configured with
 * @returns {Solo | null} the worker, or nothing when it cannot be handed over
 */
function getWorker(compiler, id, options) {
  let checks = workersByCompiler.get(compiler);

  if (!checks) {
    checks = new Map();
    workersByCompiler.set(compiler, checks);
  }

  let worker = checks.get(id);

  if (!worker) {
    const started = createSolo(nodeRequire.resolve("./typescript-worker.js"), [
      options,
    ]);

    if (!started) return null;

    worker = started;
    checks.set(id, worker);

    // The program is the worker's, so in a watch it lives as long as the
    // compiler does rather than as long as one of its builds. A watch that is
    // closed without the compiler ends it too, or the thread outlives the work.
    const stop = async () => {
      dropWorker(compiler, id);

      await /** @type {Solo} */ (worker).end();
    };

    compiler.hooks.shutdown.tapPromise("DiagnosticsPlugin", stop);
    compiler.hooks.watchClose.tap("DiagnosticsPlugin", () => {
      stop();
    });
  }

  return worker;
}

/**
 * Whether a run of this check can be handed to a worker. A `Diagnostic` holds
 * the source file it was found in, so a worker describes what it found rather
 * than sending it; a formatter written in the configuration is handed the
 * diagnostics themselves, which is a reason to run where they are.
 * @param {Options} options the options the check was configured with
 * @returns {boolean} whether the work can leave webpack's thread
 */
function canThread(options) {
  return (
    countThreads(options.threads) > 1 && typeof options.formatter !== "function"
  );
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} typescript check
 */
async function create({ key, options, compilation }) {
  const id = `${key}\0${options.configFile || ""}`;
  const worker = canThread(options)
    ? getWorker(compilation.compiler, id, options)
    : null;

  /** @type {TypeScript} */
  let typescript;

  if (!worker) {
    const loaded = await importFrom(options.typescriptPath || "typescript");

    typescript = loaded.default || loaded;
  }

  const held = getHeld(compilation.compiler, id);
  /** @type {EXPECTED_ANY} */
  let host;
  /** @type {string[]} */
  let read = [];
  /** @type {string[]} */
  let directories = [];
  /** @type {string[]} */
  let writes = [];
  /** @type {string[]} */
  let missing = [];
  // The program is the whole project, so it is built once however many batches
  // of files the plugin hands over.
  let checked = false;

  /**
   * @param {EXPECTED_ANY} one a diagnostic, or what a worker said of one
   * @returns {EXPECTED_ANY} what it says
   */
  const saying = (one) =>
    one.formatted === undefined ? describe(typescript, one) : one;

  return {
    async lintFiles() {
      if (checked) return [];

      checked = true;

      if (worker) {
        const found = await worker.lintFiles();

        read = found.files;
        directories = found.directories;
        writes = found.writes;
        missing = found.missing;

        return found.diagnostics;
      }

      const found = check(typescript, options, held);

      host = found.host;
      read = found.files;
      directories = found.directories;
      writes = found.writes;
      missing = [...held.missing];

      return found.diagnostics;
    },
    readFiles() {
      return read;
    },
    readDirectories() {
      return directories;
    },
    writesTo() {
      return writes;
    },
    missingFiles() {
      return missing;
    },
    async getResults(results) {
      return results;
    },
    filterResults(results, keep) {
      return results.filter((one) => keep(saying(one)));
    },
    splitResults(results) {
      /** @type {EXPECTED_ANY[]} */
      const errors = [];
      /** @type {EXPECTED_ANY[]} */
      const warnings = [];

      for (const one of results) {
        if (saying(one).severity === "error") errors.push(one);
        else warnings.push(one);
      }

      return { errors, warnings };
    },
    async getFormatter(formatter) {
      if (typeof formatter === "function") {
        return async (results) => String(await formatter(results));
      }

      // A worker formats each of them where the source files are, so what is
      // left of a run after `ignoreDiagnostics` is printed by joining them.
      if (worker) {
        return async (results) =>
          /** @type {Described[]} */ (results)
            .map((one) => one.formatted)
            .join("")
            .trim();
      }

      return async (results) =>
        typescript
          .formatDiagnosticsWithColorAndContext(
            /** @type {Diagnostic[]} */ (results),
            host,
          )
          .trim();
    },
    // A build that has no next one keeps no program, and a worker left running
    // would hold the process open after webpack is done with it.
    async cleanup() {
      if (!worker || compilation.compiler.watchMode) return;

      dropWorker(compilation.compiler, id);

      await worker.end();
    },
  };
}

export default {
  name: "typescript",
  label: "TypeScript",
  // The program is the one the config file describes rather than the graph
  // webpack built, so a file nothing imports is still checked.
  filesSource: "glob",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    extensions: ["ts", "tsx", "mts", "cts"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  // No `resultPath`: a diagnostic belongs to the program, not to the file the
  // plugin happened to hand over, so there is nothing to report a file from.
};
