// Mock eslint that records the files it was asked to lint
const calls = [];
const built = [];
let parserOptions = {};

class ESLintMock {
  constructor(options = {}) {
    // A copy: the check turns the cache off by editing the very object it
    // built the last linter with.
    built.push({ ...options });
  }

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
  // The options each linter was constructed with, which is where turning the
  // cache off for typed linting shows.
  _built: built,
  // What a configuration reading other files to answer for one looks like.
  _readAcrossFiles: (reads) => {
    parserOptions = reads ? { project: "./tsconfig.json" } : {};
  },
  _reset: () => {
    calls.length = 0;
    built.length = 0;
    parserOptions = {};
  },
};
