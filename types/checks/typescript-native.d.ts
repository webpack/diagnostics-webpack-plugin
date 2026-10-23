export type EXPECTED_ANY = any;
export type Options = import("../options.js").CheckOptions;
/**
 * What the native compiler says of one problem.
 */
export type NativeDiagnostic = {
  fileName?: string;
  pos: number;
  end: number;
  code: number;
  category: number;
  text: string;
  messageChain?: NativeDiagnostic[];
};
/**
 * What a run answers with, described as a worker describes it.
 */
export type Described = {
  file?: string;
  code: string;
  severity: string;
  text: string;
  formatted: string;
};
/**
 * A client of the native compiler and what it last saw of the project.
 */
export type Native = {
  api: EXPECTED_ANY;
  error: number;
  snapshot: EXPECTED_ANY;
  files: Set<string>;
};
/**
 * Checks the program the config file describes with the native compiler, which
 * runs in a process of its own: webpack's thread only waits for the answer.
 * @param {Native} native the client and what it last saw
 * @param {Options} options the options the check was configured with
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @returns {Promise<{ diagnostics: Described[], files: string[], directories: string[] }>} what it found, and what it read to find it
 */
export function checkNative(
  native: Native,
  options: Options,
  compiler: EXPECTED_ANY,
): Promise<{
  diagnostics: Described[];
  files: string[];
  directories: string[];
}>;
/**
 * The API TypeScript 7 offers in place of the compiler it no longer exposes to
 * JavaScript, or nothing for an older TypeScript, which is checked in-process.
 * @param {string} specifier where TypeScript is found
 * @returns {Promise<EXPECTED_ANY>} the native API, if this is TypeScript 7 or later
 */
export function loadNative(specifier: string): Promise<EXPECTED_ANY>;
/**
 * Starts a client of the native compiler, which spawns a process of its own.
 * @param {EXPECTED_ANY} loaded what `loadNative` loaded
 * @param {Options} options the options the check was configured with
 * @returns {Native} the client, with nothing seen yet
 */
export function startNative(loaded: EXPECTED_ANY, options: Options): Native;
/**
 * @param {Native} native the client to stop, and the process it spawned
 * @returns {Promise<void>} once it is closed
 */
export function stopNative(native: Native): Promise<void>;
