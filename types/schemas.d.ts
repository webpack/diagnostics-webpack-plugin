export type EXPECTED_ANY = any;
export type CheckAdapter = import("./checks/index.js").CheckAdapter;
/**
 * What an entry of `checks` takes: the options every check shares and the
 * ones only its own adapter understands.
 * @param {CheckAdapter} adapter the adapter the entry runs
 * @returns {EXPECTED_ANY} the entry schema
 */
export function getEntrySchema(adapter: CheckAdapter): EXPECTED_ANY;
/**
 * Read on demand, because a build that validates nothing never needs them.
 * JSON is read through CommonJS: import attributes are still ahead of the tooling.
 * @returns {{ schema: EXPECTED_ANY, entrySchema: EXPECTED_ANY }} the plugin schemas
 */
export function getSchemas(): {
  schema: EXPECTED_ANY;
  entrySchema: EXPECTED_ANY;
};
