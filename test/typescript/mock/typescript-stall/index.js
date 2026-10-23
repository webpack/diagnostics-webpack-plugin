// Real TypeScript, except that a program holding a file marked to stall keeps
// checking it until the run is cancelled, and says which way it ended.
const { writeFileSync } = require("node:fs");

const typescript = require("typescript");

const LIMIT = 30000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * @param {import("typescript").CancellationToken=} token what a run is cancelled through
 */
function stall(token) {
  const started = Date.now();

  writeFileSync(process.env.TYPESCRIPT_STALL_OUTCOME, "stalling");

  while (Date.now() - started < LIMIT) {
    if (token && token.isCancellationRequested()) {
      writeFileSync(process.env.TYPESCRIPT_STALL_OUTCOME, "cancelled");
      token.throwIfCancellationRequested();
    }

    Atomics.wait(pause, 0, 0, 5);
  }

  writeFileSync(process.env.TYPESCRIPT_STALL_OUTCOME, "timed out");
}

/**
 * @param {(...args: unknown[]) => import("typescript").BuilderProgram} make the builder to wrap
 * @returns {(...args: unknown[]) => import("typescript").BuilderProgram} it, stalling where a file asks it to
 */
const stalling =
  (make) =>
  (...args) => {
    const builder = make(...args);
    const check = builder.getSemanticDiagnostics.bind(builder);

    builder.getSemanticDiagnostics = (file, token) => {
      const stalls = builder
        .getProgram()
        .getSourceFiles()
        .some((source) => source.text.includes("// stall"));

      if (stalls) stall(token);

      return check(file, token);
    };

    return builder;
  };

module.exports = {
  ...typescript,
  createSemanticDiagnosticsBuilderProgram: stalling(
    typescript.createSemanticDiagnosticsBuilderProgram,
  ),
  createEmitAndSemanticDiagnosticsBuilderProgram: stalling(
    typescript.createEmitAndSemanticDiagnosticsBuilderProgram,
  ),
};
