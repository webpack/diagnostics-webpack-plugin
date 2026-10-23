declare namespace _default {
  export let name: string;
  export let label: string;
  export let filesSource: string;
  export const schema: any;
  export namespace defaults {
    let extensions: string[];
  }
  export function defaultExclude(): string;
  export { create };
  export function resultPath(result: EXPECTED_ANY): string;
  export { readsAcrossFiles };
}
export default _default;
export type EXPECTED_ANY = any;
export type CheckContext = import("./index.js").CheckContext;
export type CheckInstance = import("./index.js").CheckInstance;
export type Options = import("../options.js").CheckOptions;
export type FileResult = {
  /**
   * the file every diagnostic of it was found in
   */
  filename: string;
  /**
   * what oxlint found there
   */
  diagnostics: Diagnostic[];
};
export type Diagnostic = {
  /**
   * what oxlint found
   */
  message: string;
  /**
   * the rule it came from
   */
  code?: string | undefined;
  /**
   * how oxlint rates it
   */
  severity: string;
  /**
   * the file it was found in
   */
  filename: string;
  /**
   * what oxlint suggests
   */
  help?: string | undefined;
  /**
   * where it is
   */
  labels?:
    | {
        label?: string;
        span: {
          line: number;
          column: number;
        };
      }[]
    | undefined;
};
/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} oxlint check
 */
declare function create({ options }: CheckContext): Promise<CheckInstance>;
/**
 * Whether oxlint is set to read other files to answer for one: type-aware
 * rules, or the import plugin, whose `no-cycle` reports a file for what the
 * files it imports import. Whatever cannot be read — an `extends`, a config
 * written in JavaScript — is taken to, since that only costs linting again
 * what a change reaches.
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @param {Options} options the options the check was configured with
 * @returns {boolean} whether one file's results can depend on another
 */
export function readsAcrossFiles(
  compiler: EXPECTED_ANY,
  options: Options,
): boolean;
/**
 * @param {string} text a config file as written
 * @returns {EXPECTED_ANY} what it says, comments and trailing commas allowed
 */
export function parseJsonc(text: string): EXPECTED_ANY;
