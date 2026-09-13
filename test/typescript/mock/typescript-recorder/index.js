// Real TypeScript, recording whether each program was handed the one before it
const typescript = require("typescript");

const programs = [];
const build = typescript.createSemanticDiagnosticsBuilderProgram;

module.exports = {
  ...typescript,
  createSemanticDiagnosticsBuilderProgram(
    rootNames,
    options,
    host,
    oldProgram,
    ...rest
  ) {
    programs.push(Boolean(oldProgram));

    return build(rootNames, options, host, oldProgram, ...rest);
  },
  _programs: programs,
  _reset: () => {
    programs.length = 0;
  },
};
