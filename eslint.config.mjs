import { defineConfig } from "eslint/config";
import configs from "eslint-config-webpack/configs.js";

export default defineConfig([
  {
    ignores: [
      "test/biome/fixtures/**/*",
      "test/biome/outputs/**/*",
      "test/oxlint/fixtures/**/*",
      "test/oxlint/outputs/**/*",
      "test/stylelint/fixtures/**/*",
      "test/stylelint/outputs/**/*",
      "test/typescript/fixtures/**/*",
      "test/typescript/outputs/**/*",
      "test/unified/fixtures/**/*",
      "test/unified/outputs/**/*",
    ],
  },
  {
    extends: [configs["recommended-dirty"]],
  },
  {
    // `eslint-config-webpack` relaxes these for tests only when jest is a
    // dependency, and the suite runs on `node:test` instead.
    name: "diagnostics-webpack-plugin/tests",
    files: ["test/**/*.js"],
    rules: {
      camelcase: "off",
      "id-length": "off",
      "import/no-extraneous-dependencies": "off",
      "jsdoc/require-jsdoc": "off",
      "n/no-unpublished-import": "off",
      "n/no-unpublished-require": "off",
      "n/no-unsupported-features/es-builtins": "off",
      "n/no-unsupported-features/es-syntax": "off",
      "n/no-unsupported-features/node-builtins": "off",
      "no-console": "off",
      "no-control-regex": "off",
      "no-eval": "off",
    },
  },
]);
