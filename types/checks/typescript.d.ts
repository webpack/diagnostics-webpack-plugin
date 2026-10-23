export { getTypeScriptOptions } from "./typescript-program.js";
declare namespace _default {
  export let name: string;
  export let label: string;
  export let filesSource: string;
  export const schema: any;
  export namespace defaults {
    let cacheLocation: string;
    let extensions: string[];
  }
  export function defaultExclude(): string;
  export { create };
}
export default _default;
export type EXPECTED_ANY = any;
export type CheckContext = import("./index.js").CheckContext;
export type CheckInstance = import("./index.js").CheckInstance;
export type Format = import("./index.js").Format;
export type FormatterOption = import("./index.js").FormatterOption;
export type Options = import("../options.js").CheckOptions;
export type Solo = import("../threads.js").Solo;
export type TypeScript = EXPECTED_ANY;
export type Diagnostic = EXPECTED_ANY;
/**
 * What a worker answers with in place of a diagnostic it cannot hand over.
 */
export type Described = {
  file?: string;
  code: string;
  severity: string;
  text: string;
  formatted: string;
};
/**
 * What a run of the check found, and what it read to find it.
 */
export type Run = {
  /**
   * what it found
   */
  diagnostics: EXPECTED_ANY[];
  /**
   * the host that formats what it found, on this thread
   */
  host: EXPECTED_ANY;
  /**
   * the files a watcher follows for it
   */
  read: string[];
  /**
   * the directories a watcher follows for it
   */
  directories: string[];
  /**
   * what it writes
   */
  writes: string[];
  /**
   * the paths an import resolved to nothing through
   */
  missing: string[];
  /**
   * every path it read or looked for, as posix paths
   */
  reads: Set<string>;
  /**
   * where a file the program does not hold yet would be found, as posix paths ending in a slash
   */
  folders: string[];
};
/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} typescript check
 */
declare function create({
  key,
  id: entry,
  options,
  compilation,
}: CheckContext): Promise<CheckInstance>;
