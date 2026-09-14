export type Compiler = import("webpack").Compiler;
export type ArrifyResult<T> = T extends null | undefined
  ? []
  : T extends string
    ? [string]
    : T extends readonly unknown[]
      ? T
      : T extends Iterable<infer T_1>
        ? T_1[]
        : [T];
export type EXPECTED_ANY = any;
/** @typedef {import("webpack").Compiler} Compiler */
/**
 * @template T
 * @typedef {T extends (null | undefined)
 * ? []
 * : T extends string
 * ? [string]
 * : T extends readonly unknown[]
 * ? T
 * : T extends Iterable<infer T>
 * ? T[]
 * : [T]} ArrifyResult
 */
/**
 * @template T
 * @param {T} value value
 * @returns {ArrifyResult<T>} array of values
 */
export function arrify<T>(value: T): ArrifyResult<T>;
/**
 * A package name is imported as it is, so a test can still mock it. A path may
 * name a directory, which `import.meta.resolve` returns unchanged for
 * `import` to reject, so CommonJS resolution finds the entry file first.
 * @param {string} specifier a module specifier or path
 * @returns {Promise<EXPECTED_ANY>} the imported module
 */
export function importFrom(specifier: string): Promise<EXPECTED_ANY>;
/**
 * @param {string} _ key, but unused
 * @param {EXPECTED_ANY} value value
 * @returns {{ [key: string]: EXPECTED_ANY }} result
 */
export function jsonStringifyReplacerSortKeys(
  _: string,
  value: EXPECTED_ANY,
): {
  [key: string]: EXPECTED_ANY;
};
/**
 * @param {{ [key: string]: EXPECTED_ANY }} options options
 * @param {{ [key: string]: EXPECTED_ANY }} properties schema properties to drop
 * @param {string[]=} keep keys to keep even when the schema describes them
 * @returns {{ [key: string]: EXPECTED_ANY }} options the tool itself understands
 */
export function omitPluginOptions(
  options: {
    [key: string]: EXPECTED_ANY;
  },
  properties: {
    [key: string]: EXPECTED_ANY;
  },
  keep?: string[] | undefined,
): {
  [key: string]: EXPECTED_ANY;
};
/**
 * @param {string | string[]} files files
 * @param {string} context context
 * @returns {string[]} normalized paths
 */
export function parseFiles(files: string | string[], context: string): string[];
/**
 * @param {string | string[]} patterns patterns
 * @param {string | string[]} extensions extensions
 * @returns {Promise<string[]>} globs
 */
export function parseFoldersToGlobs(
  patterns: string | string[],
  extensions?: string | string[],
): Promise<string[]>;
/**
 * Globs only know the forward slash, so a path is compared and matched as one.
 * @param {string} file a path
 * @returns {string} the path with its separators turned into forward slashes
 */
export function toPosixPath(file: string): string;
/**
 * @param {Compiler} compiler compiler
 * @param {string} name absolute file name
 * @param {string | Buffer} content content
 * @returns {Promise<void>}
 */
export function writeOutputFile(
  compiler: Compiler,
  name: string,
  content: string | Buffer,
): Promise<void>;
