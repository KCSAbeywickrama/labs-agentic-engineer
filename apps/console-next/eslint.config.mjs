// Package config replaces the root config for `eslint .` runs in this
// directory (flat-config nearest-wins), so it re-exports root and layers
// React-specific rules on top.
import rootConfig from "../../eslint.config.mjs";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  ...rootConfig,
  // Static assets served verbatim (env-config.js, mockServiceWorker.js) are
  // not source code.
  { ignores: ["public/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
];
