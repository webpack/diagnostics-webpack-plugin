export default createCheckRunner;
export type Compilation = import("webpack").Compilation;
export type CheckResult = import("./checks/index.js").CheckResult;
export type CheckInstance = import("./checks/index.js").CheckInstance;
export type EnabledCheck = import("./options.js").EnabledCheck;
export type OutputReportContent = {
  filePath: string;
  content: string;
};
export type Dependencies = {
  read: string[];
  directories: string[];
  missing: string[];
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
  { name, adapter, options }: EnabledCheck,
  compilation: Compilation,
): Runner;
import DiagnosticError from "./DiagnosticError.js";
