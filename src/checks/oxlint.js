// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";

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

// The flags that turn on rules reading other files: type-aware rules,
// and the import plugin's cycles and resolution.
const ACROSS_FILES_FLAGS = new Set([
  "--type-aware",
  "--type-check",
  "--import-plugin",
]);

// What oxlint looks for when no `--config` names one.
const CONFIG_FILES = [".oxlintrc.json", ".oxlintrc.jsonc"];

/**
 * @param {string} text a config file as written
 * @returns {EXPECTED_ANY} what it says, comments and trailing commas allowed
 */
function parseJsonc(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Comments are taken out only outside strings, which keeps a glob like
    // `src/**` whole.
    const bare = text
      .replaceAll(
        /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu,
        (match, string) => string || "",
      )
      .replaceAll(/,(\s*[}\]])/gu, "$1");

    return JSON.parse(bare);
  }
}

/**
 * @param {EXPECTED_ANY} config a config, or one of its `overrides`
 * @returns {boolean} whether it turns on the import plugin
 */
function importsPlugin(config) {
  return Array.isArray(config.plugins) && config.plugins.includes("import");
}

/**
 * The config file oxlint reads for this check: the one `configFile` or a
 * `--config` among `args` names, or the one it finds in the context.
 * @param {Options} options the options the check was configured with
 * @returns {string | undefined} its path, or nothing when there is none
 */
function findConfig(options) {
  const context = String(options.context);
  const args = /** @type {string[]} */ (options.args || []);
  let named = options.configFile ? String(options.configFile) : undefined;

  for (let i = 0; i < args.length; i += 1) {
    const [flag, value] = args[i].split(/[=](.*)/su);

    if (flag === "-c" || flag === "--config") named = value ?? args[i + 1];
  }

  if (named) return isAbsolute(named) ? named : join(context, named);

  for (const name of CONFIG_FILES) {
    const path = join(context, name);

    try {
      readFileSync(path);

      return path;
    } catch {
      // Not this one.
    }
  }

  return undefined;
}

/** @type {WeakMap<Options, boolean>} */
const acrossByOptions = new WeakMap();

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
function readsAcrossFiles(compiler, options) {
  const known = acrossByOptions.get(options);

  if (known !== undefined) return known;

  let across = /** @type {string[]} */ (options.args || []).some((arg) =>
    ACROSS_FILES_FLAGS.has(arg.split("=")[0]),
  );

  if (!across) {
    const path = findConfig(options);

    if (path) {
      try {
        const config = parseJsonc(readFileSync(path, "utf8"));
        const settings = config.options || {};

        across =
          Boolean(config.extends && config.extends.length > 0) ||
          settings.typeAware === true ||
          settings.typeCheck === true ||
          importsPlugin(config) ||
          (Array.isArray(config.overrides) &&
            config.overrides.some(importsPlugin));
      } catch {
        across = true;
      }
    }
  }

  acrossByOptions.set(options, across);

  return across;
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
  // Each run is a process of its own that reads the configuration and, for
  // Biome, the project again: handed every file at once, a build starts one
  // for each 500 files rather than one for each batch webpack builds.
  lintsOnce: () => true,
  readsAcrossFiles,
};

export { parseJsonc, readsAcrossFiles };
