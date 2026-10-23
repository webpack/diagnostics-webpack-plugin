// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";

import { sharingKey } from "../check.js";
import { acquire, keptFor, release } from "../compiler-state.js";
import { countThreads, createSolo } from "../threads.js";
import { importFrom, toPosixPath } from "../utils.js";

import {
  checkNative,
  loadNative,
  startNative,
  stopNative,
} from "./typescript-native.js";
import { check, describe, getHeld, getSchemas } from "./typescript-program.js";

export { getTypeScriptOptions } from "./typescript-program.js";

/** @typedef {import("./index.js").CheckContext} CheckContext */
/** @typedef {import("./index.js").CheckInstance} CheckInstance */
/** @typedef {import("./index.js").Format} Format */
/** @typedef {import("./index.js").FormatterOption} FormatterOption */
/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {import("../threads.js").Solo} Solo */
/** @typedef {import("./typescript-native.js").Native} Native */

/** @typedef {EXPECTED_ANY} TypeScript */
/** @typedef {EXPECTED_ANY} Diagnostic */
/**
 * What a worker answers with in place of a diagnostic it cannot hand over.
 * @typedef {{ file?: string, code: string, severity: string, text: string, formatted: string }} Described
 */

/**
 * What a run of the check found, and what it read to find it.
 * @typedef {object} Run
 * @property {EXPECTED_ANY[]} diagnostics what it found
 * @property {EXPECTED_ANY} host the host that formats what it found, on this thread
 * @property {string[]} read the files a watcher follows for it
 * @property {string[]} directories the directories a watcher follows for it
 * @property {string[]} writes what it writes
 * @property {string[]} missing the paths an import resolved to nothing through
 * @property {Set<string>} reads every path it read or looked for, as posix paths
 * @property {string[]} folders where a file the program does not hold yet would be found, as posix paths ending in a slash
 * @property {string[]} extensions what a file the config file picks up ends in
 */

const nodeRequire = createRequire(import.meta.url);

/**
 * Whether a rebuild can have changed what the program says: a file it read or
 * looked for changed or went, or a script appeared where its config file would
 * pick it up. What webpack rebuilds for a stylesheet or an image is none of
 * them.
 * @param {Run} run what the last run read
 * @param {string[]} changed what webpack saw change or go since
 * @returns {boolean} whether the program has to be asked again
 */
function reaches(run, changed) {
  return changed.some((path) => {
    const file = toPosixPath(path);

    return (
      run.reads.has(file) ||
      (run.extensions.some((extension) => file.endsWith(extension)) &&
        run.folders.some((folder) => file.startsWith(folder)))
    );
  });
}

/** @type {Map<string, Promise<EXPECTED_ANY>>} */
const natives = new Map();

/**
 * The check on TypeScript 7, whose compiler runs in a process of its own and
 * answers with what it found already described.
 * @param {CheckContext} context check context
 * @param {string} id a key unique to the check within its compiler
 * @param {EXPECTED_ANY} loaded what `loadNative` loaded
 * @returns {CheckInstance} typescript check
 */
function createNative({ options, compilation }, id, loaded) {
  const { compiler } = compilation;
  // The project the native compiler opened outlives one of the builds it
  // answers for, and compilers checking it alike share the process.
  const key = `typescript-native\0${sharingKey("typescript", options) || id}`;
  const native = /** @type {Native} */ (
    acquire(compiler, key, () => startNative(loaded, options), stopNative)
  );
  /** @type {string[]} */
  let read = [];
  /** @type {string[]} */
  let directories = [];
  let checked = false;

  return {
    async lintFiles() {
      if (checked) return [];

      checked = true;

      const found = await checkNative(native, options, compiler);

      read = found.files;
      directories = found.directories;

      return found.diagnostics;
    },
    readFiles() {
      return read;
    },
    readDirectories() {
      return directories;
    },
    async getResults(results) {
      return results;
    },
    filterResults(results, keep) {
      return results.filter((one) => keep(one));
    },
    splitResults(results) {
      return {
        errors: results.filter((one) => one.severity === "error"),
        warnings: results.filter((one) => one.severity !== "error"),
      };
    },
    async getFormatter(formatter) {
      if (typeof formatter === "function") {
        return async (results) => String(await formatter(results));
      }

      return async (results) =>
        /** @type {Described[]} */ (results)
          .map((one) => one.formatted)
          .join("")
          .trim();
    },
    // A build that has no next one keeps no project, and a compiler left
    // running would hold the process open after webpack is done with it.
    async cleanup() {
      if (compiler.watchMode) return;

      await release(compiler, key);
    },
  };
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
async function create({ key, id: entry, options, compilation }) {
  // The program is this entry's: another check of the same tool reads the same
  // config file under options of its own.
  const id = `${key}\0${entry}`;
  const specifier = String(options.typescriptPath || "typescript");
  let loading = natives.get(specifier);

  if (!loading) {
    loading = loadNative(specifier);
    natives.set(specifier, loading);
  }

  const loaded = await loading;

  if (loaded) {
    return createNative({ key, id: entry, options, compilation }, id, loaded);
  }

  // Two checks that would build the same program share the worker holding it.
  const program = `typescript-worker\0${sharingKey("typescript", options) || id}`;
  const worker = canThread(options)
    ? acquire(
        compilation.compiler,
        program,
        () =>
          createSolo(nodeRequire.resolve("./typescript-worker.js"), [options]),
        (started) => started.end(),
      )
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
  // The worker's answer to this compilation's run, which is what a newer
  // compilation stops when it takes over.
  /** @type {Promise<EXPECTED_ANY> | undefined} */
  let answer;

  /**
   * @param {EXPECTED_ANY} one a diagnostic, or what a worker said of one
   * @returns {EXPECTED_ANY} what it says
   */
  const saying = (one) =>
    one.formatted === undefined ? describe(typescript, one) : one;

  const { compiler } = compilation;
  /** @type {Map<string, Run>} */
  /** @type {Map<string, Run>} */
  const runs = keptFor(compiler, "typescript-runs", () => new Map());

  /**
   * @param {Omit<Run, "reads" | "folders">} found what this run found and read
   * @param {string[]} seen every path the program asked for
   * @returns {EXPECTED_ANY[]} what it found
   */
  const remember = (found, seen) => {
    ({ host, read, directories, writes, missing } = found);
    runs.set(id, {
      ...found,
      reads: new Set(
        [...read, ...seen, ...missing].map((file) => toPosixPath(file)),
      ),
      folders: directories.map(
        (directory) => `${toPosixPath(directory).replace(/\/$/u, "")}/`,
      ),
    });

    return found.diagnostics;
  };

  return {
    async lintFiles() {
      if (checked) return [];

      checked = true;

      // A rebuild nothing the program reads took part in is answered with what
      // the last run found, without parsing the config file, reading the
      // state of every file and building the program again to learn that.
      const last = runs.get(id);
      const { modifiedFiles, removedFiles } = compiler;

      if (
        last &&
        modifiedFiles &&
        !reaches(last, [...modifiedFiles, ...(removedFiles || [])])
      ) {
        ({ host, read, directories, writes, missing } = last);

        return last.diagnostics;
      }

      if (worker) {
        answer = worker.lintFiles();

        const found = await answer;

        return remember(
          {
            diagnostics: found.diagnostics,
            host: undefined,
            read: found.files,
            directories: found.directories,
            writes: found.writes,
            missing: found.missing,
            extensions: found.extensions,
          },
          found.seen,
        );
      }

      const found = check(typescript, options, held);

      return remember(
        {
          diagnostics: found.diagnostics,
          host: found.host,
          read: found.files,
          directories: found.directories,
          writes: found.writes,
          missing: [...held.missing],
          extensions: found.extensions,
        },
        [...held.seen],
      );
    },
    // A run of an older compilation is left to finish on the worker while
    // webpack builds the next one, which waits for it before checking again.
    cancel() {
      if (worker && answer) worker.cancel(answer);
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
      // What a one-shot build found is of no use to a build after it.
      if (!compiler.watchMode) runs.delete(id);

      if (!worker || compiler.watchMode) return;

      await release(compilation.compiler, program);
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
    cacheLocation: "node_modules/.cache/diagnostics-webpack-plugin/typescript",
    extensions: ["ts", "tsx", "mts", "cts"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  // No `resultPath`: a diagnostic belongs to the program, not to the file the
  // plugin happened to hand over, so there is nothing to report a file from.
};
