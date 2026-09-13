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
 * @property {Diagnostic[]} diagnostics what Biome found there
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} severity how Biome rates it
 * @property {string} message what Biome found
 * @property {string=} category the rule it came from
 * @property {{ path?: string, start?: { line: number, column: number } }=} location where it is
 * @property {string} path the file it was found in, as this check reads it
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
      own: nodeRequire("./biome.json"),
    };
  }

  return schemas;
}

/**
 * @param {string} filename the file it was found in
 * @param {Diagnostic} diagnostic what Biome found
 * @returns {string} it as one line, Biome's own reporters being a second run
 */
function formatDiagnostic(filename, diagnostic) {
  const start = diagnostic.location && diagnostic.location.start;
  const at = start ? `:${start.line}:${start.column}` : "";
  const rule = diagnostic.category ? `  ${diagnostic.category}` : "";

  return `${filename}${at}  ${diagnostic.severity}  ${diagnostic.message}${rule}`;
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} biome check
 */
async function create({ options }) {
  const script = findBinary(
    String(options.biomePath || "@biomejs/biome"),
    "biome",
  );
  const cwd = String(options.context);
  const flags = [
    String(options.command || "lint"),
    // Biome calls this reporter experimental, so a release of its own may move
    // the shape this check reads. It is the only one that carries severities.
    "--reporter=json",
    ...(options.configFile
      ? ["--config-path", String(options.configFile)]
      : []),
    ...(options.fix ? ["--write"] : []),
    .../** @type {string[]} */ (options.args || []),
  ];

  return {
    async lintFiles(files) {
      /** @type {Diagnostic[]} */
      const found = [];

      for (let i = 0; i < files.length; i += FILES_PER_RUN) {
        const answer = await runJson(
          script,
          [...flags, ...files.slice(i, i + FILES_PER_RUN)],
          cwd,
        );

        found.push(...(answer.diagnostics || []));
      }

      // A diagnostic Biome cannot put a file to is about the run rather than
      // about the sources, and there is nothing to report it against.
      return found.flatMap((diagnostic) => {
        const path = diagnostic.location && diagnostic.location.path;

        return path ? [{ ...diagnostic, path }] : [];
      });
    },
    async getResults(results) {
      return groupByFile(
        /** @type {Diagnostic[]} */ (results),
        (diagnostic) => diagnostic.path,
        cwd,
      );
    },
    filterResults(results, keep) {
      return filterDiagnostics(
        /** @type {FileResult[]} */ (results),
        keep,
        (diagnostic) => diagnostic.category,
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
  name: "biome",
  label: "Biome",
  filesSource: "modules",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    extensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  resultPath: (/** @type {EXPECTED_ANY} */ result) =>
    /** @type {FileResult} */ (result).filename,
};
