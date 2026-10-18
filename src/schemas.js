import { createRequire } from "node:module";

// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

/** @typedef {import("./checks/index.js").CheckAdapter} CheckAdapter */

// The plugin's schemas, composed apart from `src/options.js`: that module imports the checks
// generated from them, so a missing or broken check would stop `npm run fix:schema` from
// regenerating it.

// JSON is read through CommonJS: import attributes are still ahead of the tooling
const nodeRequire = createRequire(import.meta.url);

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

/**
 * What an entry of `checks` takes: the options every check shares and the
 * ones only its own adapter understands.
 * @param {CheckAdapter} adapter the adapter the entry runs
 * @returns {EXPECTED_ANY} the entry schema
 */
function getEntrySchema(adapter) {
  const { entrySchema } = getSchemas();

  return {
    ...entrySchema,
    properties: {
      ...entrySchema.properties,
      ...adapter.schema.properties,
    },
  };
}

export { getEntrySchema, getSchemas };
