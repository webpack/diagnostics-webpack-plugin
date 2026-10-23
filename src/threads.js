// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { cpus } from "node:os";

import { Worker as JestWorker } from "jest-worker";

/** @typedef {import("./options.js").CheckOptions} CheckOptions */
/** @typedef {import("./checks/index.js").CheckResult} CheckResult */
/** @typedef {(files: string[]) => Promise<CheckResult[]>} LintTask */
/** @typedef {JestWorker & { lintFiles: LintTask }} Worker */
/** @typedef {{ lintFiles: LintTask, end: () => Promise<void> }} Pool */
/** @typedef {{ lintFiles: () => Promise<EXPECTED_ANY>, cancel: (answer: Promise<EXPECTED_ANY>) => void, end: () => Promise<void> }} Solo */

/**
 * How many threads the user asked for, as a count. A check is spread over one
 * fewer thread than the machine has, leaving webpack the one it builds on, and
 * a count is held to that ceiling: asking for more than the machine has runs
 * slower than asking for none, because the threads then compete with webpack.
 * @param {CheckOptions["threads"]} threads what was asked for
 * @returns {number} the number of threads to spread a lint over
 */
function countThreads(threads) {
  // In some environments `cpus()` answers with nothing.
  const ceiling = Math.max((cpus() || []).length - 1, 1);

  if (threads === undefined || threads === "auto" || threads === true) {
    return ceiling;
  }

  if (typeof threads === "number") {
    return Math.min(Math.max(Math.trunc(threads), 1), ceiling);
  }

  return 1;
}

/**
 * Whether a value survives the structured clone a worker is handed its setup
 * over. A function does not, and an option holding one — a formatter written
 * in the configuration, say — is a reason to lint where it was written.
 * @param {unknown} value anything a check was configured with
 * @returns {boolean} whether it can be handed to a worker
 */
function isTransferable(value) {
  if (typeof value === "function") return false;

  if (Array.isArray(value)) return value.every(isTransferable);

  if (value !== null && typeof value === "object") {
    return Object.values(value).every(isTransferable);
  }

  return true;
}

/**
 * A pool of workers running a check's own worker entry. The plugin owns the
 * pool so that every check is spread the same way, whatever it lints.
 * @param {string} source the check's worker entry
 * @param {number} size how many workers to run
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @returns {Pool | null} the pool, or nothing when the setup cannot be handed over
 */
function createPool(source, size, setupArgs) {
  if (!isTransferable(setupArgs)) return null;

  let worker = /** @type {Worker | null} */ (
    new JestWorker(source, {
      enableWorkerThreads: true,
      numWorkers: size,
      setupArgs,
    })
  );

  return {
    // One task per file, so a pool is not left waiting on whichever batch
    // happened to hold the slowest file.
    lintFiles: async (files) => {
      /* istanbul ignore next */
      if (!worker) return [];

      const results = await Promise.all(
        files.map((file) => /** @type {Worker} */ (worker).lintFiles([file])),
      );

      return results.flat();
    },
    end: async () => {
      /* istanbul ignore else */
      if (worker) {
        await worker.end();
        worker = null;
      }
    },
  };
}

/**
 * One worker running a check's own worker entry, for a check whose work cannot
 * be split over several — a type checker reads a whole program at once, so what
 * a thread buys it is webpack's own thread back rather than a share of the work.
 * @param {string} source the check's worker entry
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @returns {Solo | null} the worker, or nothing when the setup cannot be handed over
 */
function createSolo(source, setupArgs) {
  if (!isTransferable(setupArgs)) return null;

  // Each run is handed a flag it shares with the worker rather than one sent
  // to it later: a message would wait behind the run it is meant to stop. A
  // worker can be shared by checks of several compilers, so each run has a
  // flag of its own and stopping one leaves the rest.
  /** @type {WeakMap<Promise<EXPECTED_ANY>, Int32Array>} */
  const flags = new WeakMap();

  let worker = /** @type {Worker | null} */ (
    new JestWorker(source, {
      enableWorkerThreads: true,
      numWorkers: 1,
      setupArgs,
    })
  );

  return {
    // Not async: the promise handed back is the one `cancel` is given.
    lintFiles: () => {
      /* istanbul ignore next */
      if (!worker) return Promise.resolve(undefined);

      const stopped = new Int32Array(new SharedArrayBuffer(4));
      const answer = /** @type {EXPECTED_ANY} */ (worker).lintFiles(
        [],
        stopped,
      );

      flags.set(answer, stopped);

      return answer;
    },
    // Whether the run has started or is still queued.
    cancel: (answer) => {
      const stopped = flags.get(answer);

      if (stopped) Atomics.store(stopped, 0, 1);
    },
    end: async () => {
      /* istanbul ignore else */
      if (worker) {
        await worker.end();
        worker = null;
      }
    },
  };
}

export { countThreads, createPool, createSolo, isTransferable };
