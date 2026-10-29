import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.wrangler/**", "**/node_modules/**", "**/worker-configuration.d.ts", "apps/api/migrations/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["apps/admin/**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
