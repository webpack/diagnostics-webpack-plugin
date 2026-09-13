import { createRequire } from "node:module";

// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { validate } from "schema-utils";

import adapters from "./checks/index.js";

// JSON is read through CommonJS: import attributes are still ahead of the tooling
const nodeRequire = createRequire(import.meta.url);

const PLUGIN_NAME = "Diagnostics Webpack Plugin";

/** @typedef {import("webpack").Compiler} Compiler */
/** @typedef {"error" | "warning" | "log" | false} Severity */
/** @typedef {"errors" | "warnings"} Results */
/** @typedef {number | boolean | "auto"} Threads */
/** @typedef {Severity | { errors?: Severity, warnings?: Severity }} ReportAs */
/** @typedef {import("./checks/index.js").FormatterOption} FormatterOption */
/** @typedef {import("./checks/index.js").CheckAdapter} CheckAdapter */
/** @typedef {import("./checks/index.js").CheckAdapterInput} CheckAdapterInput */

/**
 * @typedef {object} OutputReport
 * @property {string=} filePath a file path
 * @property {FormatterOption=} formatter a formatter
 */

/**
 * @typedef {object} SharedOptions
 * @property {boolean=} cache enable the tool's cache to decrease execution time
 * @property {string=} cacheLocation specify the path to the cache location
 * @property {ReportAs=} reportAs what a check reports its results as
 * @property {Threads=} threads how many threads a check spreads its work over
 * @property {string | string[]=} exclude specify the files and/or directories to exclude
 * @property {string | string[]=} extensions specify the extensions that should be checked
 * @property {string | string[]=} files specify directories, files, or globs
 * @property {boolean=} fix apply fixes
 * @property {FormatterOption=} formatter specify the formatter you would like to use to format your results
 * @property {OutputReport=} outputReport writes the output of the errors to a file - for example, a `json` file for use for reporting
 * @property {RegExp | RegExp[] | string | string[]=} resourceQueryExclude specify the resource query to exclude
 */

/**
 * @typedef {string | (SharedOptions & { use: string | CheckAdapterInput, [option: string]: EXPECTED_ANY })} CheckEntry
 */

/**
 * The options of one check, as given and then as the plugin resolves them
 * against a compiler.
 * @typedef {SharedOptions & { [option: string]: EXPECTED_ANY }} CheckOptions
 */

/**
 * @typedef {object} PluginOptions
 * @property {string=} context a string indicating the root of your files
 * @property {boolean=} lintOnStart whether the first compilation lints everything
 * @property {CheckEntry[]} checks the checks to run
 */

/** @typedef {SharedOptions & PluginOptions} Options */

/**
 * @typedef {object} EnabledCheck
 * @property {string} name check name
 * @property {CheckAdapter} adapter the adapter running it
 * @property {CheckOptions} options options resolved for this check
 */

/**
 * @typedef {object} NormalizedOptions
 * @property {string=} context a string indicating the root of your files
 * @property {boolean} lintOnStart whether the first compilation lints everything
 * @property {EnabledCheck[]} checks the checks to run
 */

const DEFAULT_FOLDER_TO_EXCLUDE = "**/node_modules/**";

/** @type {{ schema: EXPECTED_ANY, entrySchema: EXPECTED_ANY } | undefined} */
let schemas;

/**
 * Read on demand, because a build that validates nothing never needs them.
 * JSON is read through CommonJS: import attributes are still ahead of the tooling.
 * @returns {{ schema: EXPECTED_ANY, entrySchema: EXPECTED_ANY }} the plugin schemas
 */
function getSchemas() {
  if (!schemas) {
    const pluginSchema = nodeRequire("./options.json");
    const sharedSchema = nodeRequire("./shared-options.json");
    const { use: useProperty, ...pluginProperties } = pluginSchema.properties;

    const entrySchema = {
      type: "object",
      additionalProperties: true,
      properties: { use: useProperty, ...sharedSchema.properties },
      required: ["use"],
    };

    schemas = {
      entrySchema,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...pluginProperties,
          ...sharedSchema.properties,
          checks: {
            ...pluginProperties.checks,
            // A check is named, or written out with the options it takes.
            items: { anyOf: [{ type: "string" }, entrySchema] },
          },
        },
        required: ["checks"],
      },
    };
  }

  return schemas;
}

/** @type {Record<Results, Severity>} */
const REPORT_AS_DEFAULTS = { errors: "error", warnings: "warning" };

/**
 * A severity covers a check's errors and its warnings alike unless an object
 * sets them apart, and one it leaves out keeps its own.
 * @param {ReportAs | undefined} reportAs the option as it was given
 * @param {Results} results which of a check's results to answer for
 * @returns {Severity} what they are reported as
 */
function reportedAs(reportAs, results) {
  if (reportAs === undefined) return REPORT_AS_DEFAULTS[results];

  if (reportAs === false || typeof reportAs === "string") return reportAs;

  return reportAs[results] ?? REPORT_AS_DEFAULTS[results];
}

/**
 * A `use` is either the name of a built-in check or an adapter of its own, so
 * a check can ship outside this package.
 * @param {string | CheckAdapterInput} use the check to resolve
 * @returns {CheckAdapter} the adapter to run
 */
function toAdapter(use) {
  if (typeof use !== "string") {
    if (!use || typeof use.create !== "function" || !use.name) {
      throw new Error(
        `${PLUGIN_NAME}: \`use\` needs the name of a built-in check or a check adapter with a \`name\` and a \`create\` function.`,
      );
    }

    return {
      label: use.name,
      filesSource: "modules",
      schema: { properties: {} },
      defaults: {},
      defaultExclude: () => DEFAULT_FOLDER_TO_EXCLUDE,
      ...use,
    };
  }

  const adapter = adapters.get(use);

  if (!adapter) {
    throw new Error(
      `${PLUGIN_NAME}: unknown check '${use}', expected one of ${[
        ...adapters.keys(),
      ]
        .map((name) => `'${name}'`)
        .join(", ")} or a check adapter.`,
    );
  }

  return adapter;
}

/**
 * Splits the options shared by every check from the per-check entries and
 * merges each entry over them.
 * @param {Options} pluginOptions plugin options
 * @returns {NormalizedOptions} normalized plugin options
 */
function getOptions(pluginOptions) {
  const {
    context,
    lintOnStart = true,
    checks: entries = [],
    ...shared
  } = pluginOptions;

  const enabled = entries.map((entry) => {
    // A check with nothing to configure is named rather than written out.
    const { use, ...own } = typeof entry === "string" ? { use: entry } : entry;
    const adapter = toAdapter(use);

    /** @type {CheckOptions} */
    const options = { ...adapter.defaults, ...shared, ...own };

    return { name: adapter.name, adapter, options };
  });

  return { context, lintOnStart, checks: enabled };
}

/**
 * Runs from `compiler.hooks.validate`, so webpack's own `validate: false`
 * turns it off the way it does for webpack's plugins.
 * @param {Compiler} compiler compiler
 * @param {Options} pluginOptions the options as they were given
 * @param {EnabledCheck[]} checks the checks resolved from them
 * @returns {void}
 */
function validateOptions(compiler, pluginOptions, checks) {
  // `compiler.validate` arrived with the hook, in webpack 5.106.
  const check = compiler.validate
    ? compiler.validate.bind(compiler)
    : /** @type {typeof compiler.validate} */ (
        (schemaToUse, value, options) =>
          validate(
            /** @type {EXPECTED_ANY} */ (
              typeof schemaToUse === "function" ? schemaToUse() : schemaToUse
            ),
            /** @type {EXPECTED_ANY} */ (value),
            options,
          )
      );

  check(() => getSchemas().schema, pluginOptions, {
    name: PLUGIN_NAME,
    baseDataPath: "options",
  });

  for (const [index, entry] of (pluginOptions.checks || []).entries()) {
    // A check named rather than written out carries no options to check.
    if (typeof entry === "string") continue;

    const { adapter } = checks[index];

    check(
      () => {
        const { entrySchema } = getSchemas();

        return {
          ...entrySchema,
          properties: {
            ...entrySchema.properties,
            ...adapter.schema.properties,
          },
        };
      },
      entry,
      {
        name: `${PLUGIN_NAME} (${adapter.label})`,
        baseDataPath: `options.checks[${index}]`,
      },
    );
  }
}

export { getOptions, reportedAs, validateOptions };
