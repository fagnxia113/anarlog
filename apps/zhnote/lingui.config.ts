import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "zh-CN",
  locales: ["zh-CN", "en"],
  compileNamespace: "ts",
  format: formatter({ lineNumbers: false }),
  fallbackLocales: {
    default: "zh-CN",
  },
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["**/*.test.*", "**/i18n/locales/**"],
    },
  ],
});
