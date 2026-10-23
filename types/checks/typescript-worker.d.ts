export type EXPECTED_ANY = any;
export type Options = import("../options.js").CheckOptions;
export type TypeScript = EXPECTED_ANY;
/**
 * Runs the check and answers with what crosses back: a `Diagnostic` holds the
 * source file it was found in, so each one is described and formatted here.
 * @param {string[]} files nothing: the program is the config file's
 * @param {number} run which run of the check this is
 * @returns {Promise<EXPECTED_ANY>} what it found, and what it read to find it
 */
export function lintFiles(files: string[], run: number): Promise<EXPECTED_ANY>;
/**
 * @param {Options} options the options the check was configured with
 * @param {Int32Array} stop the runs the plugin no longer waits for, each in the slot its number falls in, shared with it
 */
export function setup(options: Options, stop: Int32Array): void;
