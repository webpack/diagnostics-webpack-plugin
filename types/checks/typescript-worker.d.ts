export type EXPECTED_ANY = any;
export type Options = import("../options.js").CheckOptions;
export type TypeScript = EXPECTED_ANY;
/**
 * Runs the check and answers with what crosses back: a `Diagnostic` holds the
 * source file it was found in, so each one is described and formatted here.
 * @param {string[]} files nothing: the program is the config file's
 * @param {Int32Array} stopped set once nobody waits for this run, shared with the plugin
 * @returns {Promise<EXPECTED_ANY>} what it found, and what it read to find it
 */
export function lintFiles(
  files: string[],
  stopped: Int32Array,
): Promise<EXPECTED_ANY>;
/**
 * @param {Options} options the options the check was configured with
 */
export function setup(options: Options): void;
