// Compiles the plugin schema, and the schema of each built-in check's entry,
// into the standalone checks `validateOptions` hands to `compiler.validate`.
//
//   node scripts/precompile-schemas.js          # fail when a check is stale
//   node scripts/precompile-schemas.js --write  # write the checks
//
// WHY: the schemas are composed in `src/options.js`, so `schema-utils
// precompile` cannot read them from a file, and composing them here the same
// way keeps a check accepting exactly what the schema accepts.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { precompile } from "schema-utils";

import adapters from "../src/checks/index.js";
import { getEntrySchema, getSchemas } from "../src/options.js";

const write = process.argv.includes("--write");

/** @type {[URL, import("schema-utils").Schema][]} */
const outputs = [
  [new URL("../src/options.check.js", import.meta.url), getSchemas().schema],
  ...[...adapters.values()].map(
    (adapter) =>
      /** @type {[URL, import("schema-utils").Schema]} */ ([
        new URL(`../src/checks/${adapter.name}.check.js`, import.meta.url),
        getEntrySchema(adapter),
      ]),
  ),
];

let stale = false;

for (const [url, schema] of outputs) {
  const code = await precompile(schema, { esm: true, minify: true });
  const file = fileURLToPath(url);
  const current = await readFile(file, "utf8").catch(() => "");

  if (current === code) continue;

  if (write) {
    await writeFile(file, code);
    process.stdout.write(`${file} updated\n`);
  } else {
    process.stderr.write(
      `${file} is out of date, run "npm run fix:schema" to update it\n`,
    );
    stale = true;
  }
}

if (stale) process.exitCode = 1;
