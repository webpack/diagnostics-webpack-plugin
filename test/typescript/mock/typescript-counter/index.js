// Real TypeScript, writing down whether each program was built from nothing or
// from the one before it, wherever the check runs.
const { appendFileSync } = require("node:fs");

const typescript = require("typescript");

const build = typescript.createSemanticDiagnosticsBuilderProgram;

module.exports = {
  ...typescript,
  createSemanticDiagnosticsBuilderProgram(
    rootNames,
    options,
    host,
    old,
    ...rest
  ) {
    appendFileSync(
      process.env.TYPESCRIPT_COUNTER_FILE,
      old ? "reused\n" : "fresh\n",
    );

    return build(rootNames, options, host, old, ...rest);
  },
};
