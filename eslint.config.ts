import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    ignores: ["**/node_modules/*", "**/dist/*", "**/build/*"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);
