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
  export function readsAcrossFiles(): boolean;
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
   * what Biome found there
   */
  diagnostics: Diagnostic[];
};
export type Diagnostic = {
  /**
   * how Biome rates it
   */
  severity: string;
  /**
   * what Biome found
   */
  message: string;
  /**
   * the rule it came from
   */
  category?: string | undefined;
  /**
   * where it is
   */
  location?:
    | {
        path?: string;
        start?: {
          line: number;
          column: number;
        };
      }
    | undefined;
  /**
   * the file it was found in, as this check reads it
   */
  path: string;
};
/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} biome check
 */
declare function create({ options }: CheckContext): Promise<CheckInstance>;
/**
 * The binary Biome's launcher would run, found as the launcher finds it: what
 * `BIOME_BINARY` names, or the build published for this platform beside the
 * package. The launcher is a Node process of its own on every run, for nothing
 * but to start this one.
 * @param {string} script the launcher
 * @returns {string | undefined} the binary, or nothing where none is found
 */
export function findNative(script: string): string | undefined;
