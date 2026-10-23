// Mock eslint that records the files it was asked to lint
const calls = [];
const built = [];
let parserOptions = {};
let fixable = 0;
const fixed = [];

class ESLintMock {
  constructor(options = {}) {
    // A copy: the check turns the cache off by editing the very object it
    // built the last linter with.
    built.push({ ...options });
  }

  async lintFiles(files) {
    calls.push(files);

    // One result a file, finding nothing, as ESLint answers: what a check
    // keeps between builds is kept by the file it came from.
    return files.map((filePath) => ({
      filePath,
      messages: [],
      suppressedMessages: [],
      errorCount: 0,
      fatalErrorCount: 0,
      warningCount: 0,
      fixableErrorCount: fixable,
      fixableWarningCount: 0,
    }));
  }

  async calculateConfigForFile(file) {
    // ESLint has no config for a file it ignores.
    if (file.includes("ignored")) return undefined;

    return { languageOptions: { parserOptions } };
  }

  async loadFormatter() {
    return { format: (results) => JSON.stringify(results) };
  }
}

ESLintMock.version = "9";
ESLintMock.outputFixes = async (results) => {
  fixed.push(results.map(({ filePath }) => filePath));
};

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
  _fixed: fixed,
  // Whether every file comes back with something `fix` can write.
  _fixable: (count) => {
    fixable = count;
  },
  _setVersion: (version) => {
    ESLintMock.version = version;
  },
  _reset: () => {
    calls.length = 0;
    built.length = 0;
    parserOptions = {};
    fixable = 0;
    fixed.length = 0;
    ESLintMock.version = "9";
  },
};
