// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

// Real TypeScript, recording whether each program was handed the one before it
const typescript = require("typescript");

const programs = [];
const handedBack = [];
const last = new Map();
/**
 * @param {(...args: EXPECTED_ANY[]) => EXPECTED_ANY} build the builder to record
 * @returns {(...args: EXPECTED_ANY[]) => EXPECTED_ANY} it, recording each program it makes
 */
const recording =
  (build) =>
  (rootNames, options, host, oldProgram, ...rest) => {
    const project = (rootNames || []).join("\0");

    programs.push(Boolean(oldProgram));
    // A program read back from `.tsbuildinfo` is an old program too, so what
    // says the last one was kept is that it is the very same object.
    handedBack.push(
      oldProgram !== undefined && oldProgram === last.get(project),
    );

    const program = build(rootNames, options, host, oldProgram, ...rest);

    last.set(project, program);

    return program;
  };

module.exports = {
  ...typescript,
  createSemanticDiagnosticsBuilderProgram: recording(
    typescript.createSemanticDiagnosticsBuilderProgram,
  ),
  createEmitAndSemanticDiagnosticsBuilderProgram: recording(
    typescript.createEmitAndSemanticDiagnosticsBuilderProgram,
  ),
  _programs: programs,
  _handedBack: handedBack,
  _reset: () => {
    programs.length = 0;
    handedBack.length = 0;
    last.clear();
  },
};
