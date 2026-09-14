// Mock eslint that records the files it was asked to lint
const calls = [];
let parserOptions = {};

class ESLintMock {
  async lintFiles(files) {
    calls.push(files);
    return [];
  }

  async calculateConfigForFile() {
    return { languageOptions: { parserOptions } };
  }

  async loadFormatter() {
    return { format: (results) => JSON.stringify(results) };
  }
}

ESLintMock.version = "9";

module.exports = {
  ESLint: ESLintMock,
  loadESLint: async () => ESLintMock,
  _calls: calls,
  // What a configuration reading other files to answer for one looks like.
  _readAcrossFiles: (reads) => {
    parserOptions = reads ? { project: "./tsconfig.json" } : {};
  },
  _reset: () => {
    calls.length = 0;
    parserOptions = {};
  },
};
