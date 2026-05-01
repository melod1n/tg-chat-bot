import js from "@eslint/js";
import {defineConfig} from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
    {
        ignores: [
            "dist/**",
            "data/**",
            "node_modules/**",
            "**/*.tsbuildinfo",
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        linterOptions: {
            reportUnusedDisableDirectives: "off",
        },
        rules: {
            "no-console": "error",
            "no-control-regex": "off",
            "no-case-declarations": "off",
            "no-useless-escape": "off",
            "no-extra-boolean-cast": "off",
            "quotes": ["error", "double", {avoidEscape: true}],
            "semi": ["error", "always"],
            "prefer-const": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "no-unused-vars": "off",
        },
    },
    {
        files: ["src/logging/logger.ts"],
        rules: {
            "no-console": "off",
        },
    },
);
