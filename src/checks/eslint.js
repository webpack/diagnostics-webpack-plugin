// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { countThreads, createPool } from "../threads.js";
import { importFrom, omitPluginOptions } from "../utils.js";

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
      own: nodeRequire("./eslint.json"),
    };
  }

  return schemas;
}

/** @typedef {import("eslint").ESLint} ESLint */
/** @typedef {import("eslint").ESLint.Formatter} Formatter */
/** @typedef {import("eslint").ESLint.LintResult} LintResult */
/** @typedef {import("eslint").ESLint.Options} ESLintOptions */
/** @typedef {import("../checks/index.js").FormatterOption} FormatterOption */
/** @typedef {import("../checks/index.js").CheckContext} CheckContext */
/** @typedef {import("../checks/index.js").CheckInstance} CheckInstance */
/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {{ new (arg0: ESLintOptions): ESLint, outputFixes: (arg0: LintResult[]) => Promise<void>, version: string }} ESLintClass */

// ESLint 9 hardcodes this in its CLI; only ESLint 10 exposes it on the service.
const DEFAULT_SUPPRESSIONS_FILE = "eslint-suppressions.json";

// `fix` and `extensions` are meaningful to ESLint itself, the rest of the
// plugin schema is not.
const KEPT_OPTIONS = ["cache", "cacheLocation", "extensions", "fix"];

// Measured: starting a pool costs a few hundred milliseconds, which a batch
// smaller than this lints in less.
const POOL_WORTH_STARTING = 64;

/**
 * @param {ESLint} eslint eslint
 * @param {LintResult[]} results results
 * @returns {Promise<LintResult[]>} results without the warnings of ignored files
 */
async function removeIgnoredWarnings(eslint, results) {
  const filterPromises = results.map(async (result) => {
    // Short circuit the call to isPathIgnored.
    //   fatal is false for ignored file warnings.
    //   ruleId is unset for internal ESLint errors.
    //   line is unset for warnings not involving file contents.
    const { messages, warningCount, errorCount, filePath } = result;
    const [firstMessage] = messages;
    const hasWarning = warningCount === 1 && errorCount === 0;
    const ignored =
      messages.length === 0 ||
      (hasWarning &&
        !firstMessage.fatal &&
        !firstMessage.ruleId &&
        !firstMessage.line &&
        (await eslint.isPathIgnored(filePath)));
    return ignored ? false : result;
  });

  return /** @type {LintResult[]} */ (
    (await Promise.all(filterPromises)).filter((result) => result !== false)
  );
}

/**
 * ESLint 10 applies suppressions itself; 9 ships the same service but wires it
 * into its CLI alone, so the plugin drives it the way ESLint 10 would.
 * @param {string} specifier the `eslintPath`, or `eslint`
 * @param {ESLintOptions} eslintOptions the options ESLint was given
 * @returns {Promise<(results: LintResult[]) => Promise<LintResult[]>>} drops suppressed messages
 */
async function createSuppressionsFilter(specifier, eslintOptions) {
  const manifest =
    isAbsolute(specifier) || specifier.startsWith(".")
      ? pathToFileURL(join(specifier, "package.json")).href
      : import.meta.resolve(`${specifier}/package.json`);

  let SuppressionsService;

  try {
    // `exports` hides the service, so it is read by path rather than specifier.
    const service = await import(
      new URL("./lib/services/suppressions-service.js", manifest).href
    );

    ({ SuppressionsService } = service.default || service);
  } catch (error) {
    throw new Error(
      "`applySuppressions` needs ESLint 9.24 or later, and the ESLint in use does not ship suppressions.",
      { cause: error },
    );
  }

  const cwd = eslintOptions.cwd || process.cwd();
  const filePath = resolve(
    cwd,
    eslintOptions.suppressionsLocation || DEFAULT_SUPPRESSIONS_FILE,
  );
  const suppressions = new SuppressionsService({ cwd, filePath });

  return async (results) =>
    suppressions.applySuppressions(results, await suppressions.load()).results;
}

/**
 * @param {ESLint} eslint eslint
 * @param {FormatterOption=} formatter formatter
 * @returns {Promise<Formatter>} loaded formatter
 */
async function loadFormatter(eslint, formatter) {
  if (typeof formatter === "function") {
    return { format: /** @type {Formatter["format"]} */ (formatter) };
  }

  if (typeof formatter === "string") {
    try {
      return await eslint.loadFormatter(formatter);
    } catch {
      // Load the default formatter.
    }
  }

  return eslint.loadFormatter();
}

/**
 * Whether the loaded ESLint spreads a lint over threads of its own, which it
 * has done under `concurrency` since 9.34.0.
 * @param {string} version the loaded ESLint's version
 * @returns {boolean} whether it threads a lint itself
 */
function threadsItself(version) {
  const [major, minor] = version.split(".").map(Number);

  return major > 9 || (major === 9 && minor >= 34);
}

/**
 * @param {Options} options plugin options
 * @returns {ESLintOptions} the options ESLint itself understands
 */
function getESLintOptions(options) {
  const eslintOptions = /** @type {ESLintOptions} */ (
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

  // Some options aren't available in flat mode.
  if (options.configType === "flat") {
    delete (
      /** @type {{ extensions?: string[] }} */ (eslintOptions).extensions
    );
  }

  return eslintOptions;
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} eslint check
 */
async function create({ options }) {
  const eslintOptions = getESLintOptions(options);
  const fix = Boolean(eslintOptions.fix);
  const specifier = options.eslintPath || "eslint";

  const eslintModule = await importFrom(specifier);

  /** @type {ESLintClass} */
  const ESLint = await eslintModule.loadESLint({
    useFlatConfig: options.configType === "flat",
  });

  /** @type {((results: LintResult[]) => Promise<LintResult[]>) | undefined} */
  let applySuppressions;

  if (
    eslintOptions.applySuppressions &&
    Number.parseInt(ESLint.version, 10) < 10
  ) {
    applySuppressions = await createSuppressionsFilter(
      specifier,
      eslintOptions,
    );
    delete eslintOptions.applySuppressions;
    delete eslintOptions.suppressionsLocation;
  }

  const threads = countThreads(options.threads);
  // ESLint threads a lint itself from 9.34.0, and only under flat config, so
  // anything older or in eslintrc mode is spread over a pool of our own.
  const own =
    threads > 1 &&
    options.configType === "flat" &&
    threadsItself(ESLint.version);

  // Whatever was written against ESLint itself is what ESLint is given.
  if (own && eslintOptions.concurrency === undefined) {
    eslintOptions.concurrency =
      options.threads === undefined ||
      options.threads === true ||
      options.threads === "auto"
        ? // ESLint sizes this against the machine better than a count does.
          "auto"
        : threads;
  }

  const eslint = new ESLint(eslintOptions);

  /** @type {import("../threads.js").Pool | null} */
  let pool = null;

  /**
   * A pool is worth its workers only once a batch is big enough to outweigh
   * starting them, which a rebuild of a handful of files is not. The threshold
   * is a count rather than a share of the machine so that a build lints the
   * same way whatever it runs on.
   * @param {string[]} files the files of this batch
   * @returns {boolean} whether to spread them
   */
  const spread = (files) => {
    if (own || threads <= 1 || files.length < POOL_WORTH_STARTING) return false;

    if (!pool) {
      pool = createPool(
        fileURLToPath(import.meta.resolve("./eslint-worker.js")),
        // No more workers than there are files for them.
        Math.min(files.length, threads),
        [specifier, eslintOptions, options.configType === "flat"],
      );
    }

    return pool !== null;
  };

  return {
    async lintFiles(files) {
      const results = /** @type {LintResult[]} */ (
        spread(files)
          ? await /** @type {import("../threads.js").Pool} */ (pool).lintFiles(
              files,
            )
          : await eslint.lintFiles(files)
      );

      // If enabled, use the ESLint autofixing where possible.
      if (fix) {
        await ESLint.outputFixes(results);
      }

      return results;
    },
    async getResults(results) {
      const suppressed = applySuppressions
        ? await applySuppressions(/** @type {LintResult[]} */ (results))
        : /** @type {LintResult[]} */ (results);

      return removeIgnoredWarnings(eslint, suppressed);
    },
    filterResults(results, keep) {
      /** @type {LintResult[]} */
      const kept = [];

      for (const file of /** @type {LintResult[]} */ (results)) {
        const messages = file.messages.filter((message) =>
          keep({
            file: file.filePath,
            code: message.ruleId || undefined,
            severity: message.severity === 2 ? "error" : "warning",
            text: message.message,
          }),
        );

        if (messages.length === 0) continue;

        kept.push({
          ...file,
          messages,
          errorCount: messages.filter((message) => message.severity === 2)
            .length,
          warningCount: messages.filter((message) => message.severity === 1)
            .length,
        });
      }

      return kept;
    },
    splitResults(results) {
      /** @type {LintResult[]} */
      const errors = [];
      /** @type {LintResult[]} */
      const warnings = [];

      for (const file of /** @type {LintResult[]} */ (results)) {
        if (file.errorCount > 0) {
          const messages = file.messages.filter(
            (message) => message.severity === 2,
          );

          if (messages.length > 0) errors.push({ ...file, messages });
        }

        if (file.warningCount > 0) {
          const messages = file.messages.filter(
            (message) => message.severity === 1,
          );

          if (messages.length > 0) warnings.push({ ...file, messages });
        }
      }

      return { errors, warnings };
    },
    async getFormatter(formatter) {
      const loaded = await loadFormatter(eslint, formatter);

      return async (results) =>
        loaded.format(/** @type {LintResult[]} */ (results));
    },
    async cleanup() {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };
}

export { getESLintOptions };

export default {
  name: "eslint",
  label: "ESLint",
  filesSource: "modules",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    cache: true,
    cacheLocation:
      "node_modules/.cache/diagnostics-webpack-plugin/.eslintcache",
    configType: "flat",
    extensions: "js",
  },
  defaultExclude: () => "**/node_modules/**",
  resultPath: (/** @type {EXPECTED_ANY} */ result) =>
    /** @type {LintResult} */ (result).filePath,
  create,
  getESLintOptions,
};
