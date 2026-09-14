// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { countThreads, createPool } from "../threads.js";
import {
  jsonStringifyReplacerSortKeys,
  omitPluginOptions,
  parseFiles,
} from "../utils.js";

import { createLinter } from "./stylelint-worker.js";

const nodeRequire = createRequire(import.meta.url);

/** @type {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY } | undefined} */
let schemas;

/**
 * Read on demand, because a build that validates nothing never needs them.
 * JSON is read through CommonJS: import attributes are still ahead of the tooling.
 * @returns {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY }} the schemas
 */
function getSchemas() {
  if (!schemas) {
    schemas = {
      plugin: nodeRequire("../options.json"),
      shared: nodeRequire("../shared-options.json"),
      own: nodeRequire("./stylelint.json"),
    };
  }

  return schemas;
}

/** @typedef {import("stylelint").Formatter} Formatter */
/** @typedef {import("stylelint").FormatterType} FormatterType */
/** @typedef {import("stylelint").LintResult} LintResult */
/** @typedef {import("stylelint").LinterOptions} StylelintOptions */
/** @typedef {import("stylelint").LinterResult} LinterResult */
/** @typedef {import("stylelint").RuleMeta} RuleMeta */
/** @typedef {import("webpack").Compiler} Compiler */
/** @typedef {import("../checks/index.js").FormatterOption} FormatterOption */
/** @typedef {import("../checks/index.js").CheckContext} CheckContext */
/** @typedef {import("../checks/index.js").CheckInstance} CheckInstance */
/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {{ lint: (options: StylelintOptions) => Promise<LinterResult>, formatters: { [key: string]: Formatter } }} Stylelint */
/** @typedef {(files: string | string[]) => Promise<LintResult[]>} LintTask */
/** @typedef {{ getStylelint: () => Promise<Stylelint>, lintFiles: LintTask, cleanup: () => Promise<void>, threads: number }} Loaded */
/** @typedef {{ [file: string]: LintResult }} LintResultMap */
/** @typedef {{ [ruleName: string]: Partial<RuleMeta> }} RuleMetadata */
/** @typedef {LintResult & { ruleMetadata?: RuleMetadata }} Reported */

// `files`, `formatter` and `fix` are meaningful to Stylelint itself, the rest
// of the plugin schema is not.
// `formatter` is not among them: the plugin formats what is left of a run
// after `ignoreDiagnostics`, so handing it to Stylelint as well only makes a
// report nothing reads — and makes Stylelint the one to reject a bad name.
const KEPT_OPTIONS = ["cache", "cacheLocation", "files", "fix"];

/** @type {{ [key: string]: Loaded }} */
const cache = {};

/**
 * @param {Options} options options
 * @returns {Partial<StylelintOptions>} stylelint options
 */
function getStylelintOptions(options) {
  return /** @type {Partial<StylelintOptions>} */ (
    omitPluginOptions(
      options,
      {
        ...getSchemas().plugin.properties,
        ...getSchemas().shared.properties,
        ...getSchemas().own.properties,
      },
      KEPT_OPTIONS,
    )
  );
}

/**
 * @param {Options} options options
 * @returns {Loaded} loaded stylelint
 */
function loadStylelint(options) {
  const linter = createLinter(
    String(options.stylelintPath || "stylelint"),
    getStylelintOptions(options),
  );

  return {
    getStylelint: linter.getStylelint,
    lintFiles: linter.lintFiles,
    cleanup: async () => {},
    threads: 1,
  };
}

/**
 * @param {string | string[]} files one file or several
 * @returns {string[]} them as a list, which is what a pool is given
 */
function arrifyFiles(files) {
  return Array.isArray(files) ? files : [files];
}

/**
 * @param {string} cacheKey the key the loaded stylelint is cached under
 * @param {number} poolSize number of workers
 * @param {Options} options options
 * @returns {Loaded} loaded stylelint
 */
function loadStylelintThreaded(cacheKey, poolSize, options) {
  const source = fileURLToPath(import.meta.resolve("./stylelint-worker.js"));
  const local = loadStylelint(options);

  // Stylelint threads nothing of its own, so the plugin's pool runs it — the
  // same pool every check that cannot thread itself is spread over.
  let pool = createPool(source, poolSize, [
    options,
    getStylelintOptions(options),
  ]);

  if (!pool) return local;

  /** @type {Loaded} */
  const context = {
    ...local,
    threads: poolSize,
    lintFiles: async (files) =>
      /* istanbul ignore next */
      pool ? pool.lintFiles(arrifyFiles(files)) : local.lintFiles(files),
    cleanup: async () => {
      cache[cacheKey] = local;
      context.lintFiles = (files) => local.lintFiles(files);
      /* istanbul ignore next */
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };

  return context;
}

/**
 * @param {string | undefined} key a cache key
 * @param {Options} options options
 * @returns {string} a stringified cache key
 */
function getCacheKey(key, options) {
  return JSON.stringify({ key, options }, jsonStringifyReplacerSortKeys);
}

/**
 * @param {Reported[]} results lint results
 * @returns {RuleMetadata} a rule meta
 */
function getRuleMetadata(results) {
  for (const result of results) {
    if (result.ruleMetadata) return result.ruleMetadata;
  }

  return {};
}

/**
 * @param {Stylelint} stylelint stylelint
 * @param {FormatterOption=} formatter formatter
 * @returns {Promise<Formatter>} loaded formatter
 */
async function loadFormatter(stylelint, formatter) {
  if (typeof formatter === "function") {
    return /** @type {Formatter} */ (formatter);
  }

  // A name Stylelint has no formatter under reads as nothing rather than
  // throwing, so the default is what answers for it.
  if (typeof formatter === "string" && stylelint.formatters[formatter]) {
    return stylelint.formatters[formatter];
  }

  return stylelint.formatters.string;
}

/**
 * Stylelint is loaded once per key and options, so a watch rebuild reuses the
 * worker pool the previous run started.
 * @param {string | undefined} key a cache key
 * @param {Options} options options
 * @returns {Loaded} loaded stylelint
 */
function getLoadedStylelint(key, options) {
  const cacheKey = getCacheKey(key, options);
  const poolSize = countThreads(options.threads);

  if (!cache[cacheKey]) {
    cache[cacheKey] =
      poolSize > 1
        ? loadStylelintThreaded(cacheKey, poolSize, options)
        : loadStylelint(options);
  }

  return cache[cacheKey];
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} stylelint check
 */
async function create({ key, options }) {
  const loaded = getLoadedStylelint(key, options);

  /** @type {LintResult[]} */
  let lastResults = [];

  return {
    async lintFiles(files) {
      const resolved = parseFiles(files, String(options.context));

      return loaded.lintFiles(resolved);
    },
    async getResults(results) {
      lastResults = /** @type {LintResult[]} */ (results).filter(
        (result) => !result.ignored,
      );

      return lastResults;
    },
    filterResults(results, keep) {
      /** @type {LintResult[]} */
      const kept = [];

      for (const file of /** @type {LintResult[]} */ (results)) {
        const warnings = file.warnings.filter((message) =>
          keep({
            file: file.source,
            code: message.rule,
            severity: message.severity === "error" ? "error" : "warning",
            text: message.text,
          }),
        );

        if (warnings.length > 0) kept.push({ ...file, warnings });
      }

      return kept;
    },
    splitResults(results) {
      /** @type {LintResult[]} */
      const errors = [];
      /** @type {LintResult[]} */
      const warnings = [];

      for (const file of /** @type {LintResult[]} */ (results)) {
        const fileErrors = file.warnings.filter(
          (message) => message.severity === "error",
        );

        if (fileErrors.length > 0) {
          errors.push({ ...file, warnings: fileErrors });
        }

        const fileWarnings = file.warnings.filter(
          (message) => message.severity === "warning",
        );

        if (fileWarnings.length > 0) {
          warnings.push({ ...file, warnings: fileWarnings });
        }
      }

      return { errors, warnings };
    },
    async getFormatter(formatter) {
      const stylelint = await loaded.getStylelint();
      const loadedFormatter = await loadFormatter(stylelint, formatter);

      return async (results) => {
        /** @type {LinterResult} */
        const returnValue = {
          cwd: /** @type {string} */ (options.cwd),
          errored: false,
          results: [],
          report: "",
          reportedDisables: [],
          ruleMetadata: getRuleMetadata(lastResults),
        };

        return String(
          loadedFormatter(/** @type {LintResult[]} */ (results), returnValue),
        );
      };
    },
    cleanup: () => loaded.cleanup(),
  };
}

export { getLoadedStylelint, getStylelintOptions };

export default {
  name: "stylelint",
  label: "Stylelint",
  filesSource: "glob",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    cache: true,
    cacheLocation:
      "node_modules/.cache/diagnostics-webpack-plugin/.stylelintcache",
    extensions: ["css", "scss", "sass"],
  },
  getLoadedStylelint,
  getStylelintOptions,
  resultPath: (/** @type {EXPECTED_ANY} */ result) =>
    /** @type {LintResult} */ (result).source || undefined,
  /**
   * @param {Compiler} compiler compiler
   * @returns {string[]} default excluded globs
   */
  defaultExclude: (compiler) =>
    parseFiles(
      ["**/node_modules/**", String(compiler.options.output.path)],
      String(compiler.options.context),
    ),
  create,
};
