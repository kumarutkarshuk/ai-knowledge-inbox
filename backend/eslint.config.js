import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/frontend/**"], message: "backend must not import from frontend" },
          ],
        },
      ],
    },
  },
  prettier,
);
