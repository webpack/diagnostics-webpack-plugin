export type CheckOptions = import("./options.js").CheckOptions;
export type CheckResult = import("./checks/index.js").CheckResult;
export type LintTask = (files: string[]) => Promise<CheckResult[]>;
export type Worker = JestWorker & {
  lintFiles: LintTask;
};
export type Pool = {
  lintFiles: LintTask;
  end: () => Promise<void>;
};
export type Solo = {
  lintFiles: () => Promise<EXPECTED_ANY>;
  end: () => Promise<void>;
};
export type EXPECTED_ANY = any;
/** @typedef {import("./options.js").CheckOptions} CheckOptions */
/** @typedef {import("./checks/index.js").CheckResult} CheckResult */
/** @typedef {(files: string[]) => Promise<CheckResult[]>} LintTask */
/** @typedef {JestWorker & { lintFiles: LintTask }} Worker */
/** @typedef {{ lintFiles: LintTask, end: () => Promise<void> }} Pool */
/** @typedef {{ lintFiles: () => Promise<EXPECTED_ANY>, end: () => Promise<void> }} Solo */
/**
 * How many threads the user asked for, as a count. A check is spread over one
 * fewer thread than the machine has, leaving webpack the one it builds on, and
 * a count is held to that ceiling: asking for more than the machine has runs
 * slower than asking for none, because the threads then compete with webpack.
 * @param {CheckOptions["threads"]} threads what was asked for
 * @returns {number} the number of threads to spread a lint over
 */
export function countThreads(threads: CheckOptions["threads"]): number;
/**
 * A pool of workers running a check's own worker entry. The plugin owns the
 * pool so that every check is spread the same way, whatever it lints.
 * @param {string} source the check's worker entry
 * @param {number} size how many workers to run
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @returns {Pool | null} the pool, or nothing when the setup cannot be handed over
 */
export function createPool(
  source: string,
  size: number,
  setupArgs: unknown[],
): Pool | null;
/**
 * One worker running a check's own worker entry, for a check whose work cannot
 * be split over several — a type checker reads a whole program at once, so what
 * a thread buys it is webpack's own thread back rather than a share of the work.
 * @param {string} source the check's worker entry
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @returns {Solo | null} the worker, or nothing when the setup cannot be handed over
 */
export function createSolo(source: string, setupArgs: unknown[]): Solo | null;
/**
 * Whether a value survives the structured clone a worker is handed its setup
 * over. A function does not, and an option holding one — a formatter written
 * in the configuration, say — is a reason to lint where it was written.
 * @param {unknown} value anything a check was configured with
 * @returns {boolean} whether it can be handed to a worker
 */
export function isTransferable(value: unknown): boolean;
import { Worker as JestWorker } from "jest-worker";
