import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "packages/client/public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-constant-condition": "off",
      "no-empty": "off",
      "prefer-const": "warn",
    },
  },
  {
    files: ["packages/shared/src/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Use seeded RNG from shared/rng" }],
    },
  },
);
