// Real TypeScript, writing down whether each program was built from the very
// one this module built last, wherever the check runs. A program read back
// from `.tsbuildinfo` is an old program too, but not one kept in memory.
const { appendFileSync } = require("node:fs");

const typescript = require("typescript");

let last;

const counting =
  (build) =>
  (rootNames, options, host, old, ...rest) => {
    appendFileSync(
      process.env.TYPESCRIPT_COUNTER_FILE,
      old !== undefined && old === last ? "reused\n" : "fresh\n",
    );

    last = build(rootNames, options, host, old, ...rest);

    return last;
  };

module.exports = {
  ...typescript,
  createSemanticDiagnosticsBuilderProgram: counting(
    typescript.createSemanticDiagnosticsBuilderProgram,
  ),
  createEmitAndSemanticDiagnosticsBuilderProgram: counting(
    typescript.createEmitAndSemanticDiagnosticsBuilderProgram,
  ),
};
