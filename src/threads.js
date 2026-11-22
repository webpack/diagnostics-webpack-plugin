// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { cpus } from "node:os";

import { Worker as JestWorker } from "jest-worker";

/** @typedef {import("./options.js").CheckOptions} CheckOptions */
/** @typedef {import("./checks/index.js").CheckResult} CheckResult */
/** @typedef {(files: string[]) => Promise<CheckResult[]>} LintTask */
/** @typedef {JestWorker & { lintFiles: LintTask }} Worker */
/** @typedef {{ lintFiles: LintTask, end: () => Promise<void>, shared: boolean }} Pool */
/**
 * What the plugin reads of webpack's shared thread pool, `compiler.worker()`;
 * a webpack without it has none, so it is optional. Its calls answer with
 * whatever the worker entry returned, results of a check here.
 * @typedef {{ watchMode?: boolean, worker?: (workerPath: string, options?: { numWorkers?: number }) => { run: (method: string, ...args: EXPECTED_ANY[]) => Promise<EXPECTED_ANY> } }} ThreadsCompiler
 */
/** @typedef {{ lintFiles: () => Promise<EXPECTED_ANY>, end: () => Promise<void> }} Solo */

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

// Numbers the runs a shared pool is handed: a worker entry keeps the linter it
// built for a run, and a new number is what tells it to build a fresh one.
let lastRun = 0;

/**
 * A pool of workers running a check's own worker entry. The plugin owns the
 * pool so that every check is spread the same way, whatever it lints.
 *
 * On a webpack with `compiler.worker()` the pool is webpack's outside watch
 * mode: the threads are shared with webpack's other work, so the check
 * starts none of its own. A thread then keeps one linter per run (see
 * `lintFilesWith` in the worker entries), which `end()` retires by starting a
 * new run, so a configuration changed between runs is read again as it is
 * when the workers are started anew.
 * @param {string} source the check's worker entry
 * @param {number} size how many workers to run
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @param {ThreadsCompiler=} compiler the compiler whose threads to use, when it has them
 * @returns {Pool | null} the pool, or nothing when the setup cannot be handed over
 */
function createPool(source, size, setupArgs, compiler) {
  if (!isTransferable(setupArgs)) return null;

  // Watching, a rebuild's batches are too small to spread and lint here,
  // so webpack's threads gained no time and peaked 14% higher in memory.
  if (
    compiler &&
    typeof compiler.worker === "function" &&
    !compiler.watchMode
  ) {
    const shared = compiler.worker(source, { numWorkers: size });
    let run = ++lastRun;

    return {
      shared: true,
      // One task per file, as below.
      lintFiles: async (files) => {
        const results = await Promise.all(
          files.map((file) =>
            shared.run("lintFilesWith", run, setupArgs, [file]),
          ),
        );

        return results.flat();
      },
      end: async () => {
        run = ++lastRun;
      },
    };
  }

  let worker = /** @type {Worker | null} */ (
    new JestWorker(source, {
      enableWorkerThreads: true,
      numWorkers: size,
      setupArgs,
    })
  );

  return {
    shared: false,
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

  let worker = /** @type {Worker | null} */ (
    new JestWorker(source, {
      enableWorkerThreads: true,
      numWorkers: 1,
      setupArgs,
    })
  );

  return {
    lintFiles: async () => {
      /* istanbul ignore next */
      if (!worker) return undefined;

      return /** @type {Worker} */ (worker).lintFiles([]);
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
