// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";

import {
  filterDiagnostics,
  findBinary,
  groupByFile,
  runJson,
  splitBySeverity,
} from "../cli.js";

/** @typedef {import("./index.js").CheckContext} CheckContext */
/** @typedef {import("./index.js").CheckInstance} CheckInstance */
/** @typedef {import("../options.js").CheckOptions} Options */

/**
 * @typedef {object} FileResult
 * @property {string} filename the file every diagnostic of it was found in
 * @property {Diagnostic[]} diagnostics what oxlint found there
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} message what oxlint found
 * @property {string=} code the rule it came from
 * @property {string} severity how oxlint rates it
 * @property {string} filename the file it was found in
 * @property {string=} help what oxlint suggests
 * @property {{ label?: string, span: { line: number, column: number } }[]=} labels where it is
 */

const nodeRequire = createRequire(import.meta.url);

// An argument list is not unbounded, so a batch past this is run in several.
const FILES_PER_RUN = 500;

/** @type {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY } | undefined} */
let schemas;

/**
 * Read on demand so that requiring the plugin does not read three files.
 * @returns {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY }} the schemas
 */
function getSchemas() {
  if (!schemas) {
    schemas = {
      plugin: nodeRequire("../options.json"),
      shared: nodeRequire("../shared-options.json"),
      own: nodeRequire("./oxlint.json"),
    };
  }

  return schemas;
}

/**
 * @param {string} filename the file it was found in
 * @param {Diagnostic} diagnostic what oxlint found
 * @returns {string} it as one line, where oxlint's own formatters are a second run
 */
function formatDiagnostic(filename, diagnostic) {
  const [label] = diagnostic.labels || [];
  const at = label ? `:${label.span.line}:${label.span.column}` : "";
  const rule = diagnostic.code ? `  ${diagnostic.code}` : "";

  return `${filename}${at}  ${diagnostic.severity}  ${diagnostic.message}${rule}`;
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} oxlint check
 */
async function create({ options }) {
  const script = findBinary(String(options.oxlintPath || "oxlint"), "oxlint");
  const cwd = String(options.context);
  const flags = [
    "--format=json",
    ...(options.configFile ? ["--config", String(options.configFile)] : []),
    ...(options.fix ? ["--fix"] : []),
    .../** @type {string[]} */ (options.args || []),
  ];

  return {
    async lintFiles(files) {
      /** @type {Diagnostic[]} */
      const found = [];

      for (let i = 0; i < files.length; i += FILES_PER_RUN) {
        found.push(
          ...((
            await runJson(
              script,
              [...flags, ...files.slice(i, i + FILES_PER_RUN)],
              cwd,
            )
          ).diagnostics || []),
        );
      }

      return found;
    },
    async getResults(results) {
      return groupByFile(
        /** @type {Diagnostic[]} */ (results),
        (diagnostic) => diagnostic.filename,
        cwd,
      );
    },
    filterResults(results, keep) {
      return filterDiagnostics(
        /** @type {FileResult[]} */ (results),
        keep,
        (diagnostic) => diagnostic.code,
      );
    },
    splitResults(results) {
      return splitBySeverity(/** @type {FileResult[]} */ (results));
    },
    async getFormatter(formatter) {
      if (typeof formatter === "function") {
        return async (results) => String(await formatter(results));
      }

      return async (results) =>
        /** @type {FileResult[]} */ (results)
          .flatMap((file) =>
            file.diagnostics.map((diagnostic) =>
              formatDiagnostic(file.filename, diagnostic),
            ),
          )
          .join("\n");
    },
    async cleanup() {},
  };
}

export default {
  name: "oxlint",
  label: "oxlint",
  filesSource: "modules",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    extensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  resultPath: (/** @type {EXPECTED_ANY} */ result) =>
    /** @type {FileResult} */ (result).filename,
};
