import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/backend/**"], message: "frontend must not import from backend" },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  prettier,
);
