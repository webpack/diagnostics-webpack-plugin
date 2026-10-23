export default createCheckRunner;
export type EXPECTED_ANY = any;
export type Compilation = import("webpack").Compilation;
export type CheckResult = import("./checks/index.js").CheckResult;
export type CheckInstance = import("./checks/index.js").CheckInstance;
export type EnabledCheck = import("./options.js").EnabledCheck;
export type Ignore = import("./options.js").Ignore;
export type IgnoreMatch = import("./options.js").IgnoreMatch;
export type IgnoreOne = import("./options.js").IgnoreOne;
export type Message = import("./options.js").Message;
export type OutputReportContent = {
  filePath: string;
  content: string;
};
export type Dependencies = {
  read: string[];
  directories: string[];
  missing: string[];
  writes: string[];
};
export type Run = Dependencies & {
  results: CheckResult[];
};
export type Report = Dependencies & {
  errors?: DiagnosticError;
  warnings?: DiagnosticError;
  outputReport?: OutputReportContent;
};
export type Runner = {
  lint: (files: string[]) => void;
  keep: (files: string[]) => void;
  report: () => Promise<Report>;
  detach: (report: Promise<Report>) => void;
};
export type ResultStore = Map<string, CheckResult | undefined>;
/**
 * What tells one check's run of a tool from another's, so that only two runs
 * that would do the same work are shared.
 * @param {string} name the name of the check
 * @param {EnabledCheck["options"]} options the options it runs under
 * @returns {string | undefined} the key, or nothing when they cannot be compared
 */
export function sharingKey(
  name: string,
  options: EnabledCheck["options"],
): string | undefined;
/**
 * Creates the runner synchronously so that the compilation hooks are tapped
 * before webpack starts building modules, whatever the tool takes to load. A
 * run the last compilation left to finish on its own is waited for first, so
 * that a check never has two of its tools running side by side.
 * @param {string} key a key unique to the compiler the check runs for
 * @param {EnabledCheck} check the check to run
 * @param {Compilation} compilation compilation
 * @returns {Runner} the runner collecting and reporting the results
 */
declare function createCheckRunner(
  key: string,
  { id, name, adapter, options }: EnabledCheck,
  compilation: Compilation,
): Runner;
import DiagnosticError from "./DiagnosticError.js";
