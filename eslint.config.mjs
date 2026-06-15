// Flat ESLint config for all TypeScript in the workspace.
// Generated code and build output are never linted.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/generated/**",
      "**/*.gen.*",
      "**/node_modules/**",
      "**/.turbo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
