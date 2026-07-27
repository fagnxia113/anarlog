import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { type ReactNode, useEffect, useState } from "react";

import { messages as zhCN } from "./locales/zh-CN/messages";
import { messages as en } from "./locales/en/messages";

i18n.load({
  "zh-CN": zhCN,
  en: en,
});
i18n.activate("zh-CN");

export function AppI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<string>("zh-CN");

  useEffect(() => {
    const saved = localStorage.getItem("locale");
    if (saved) setLocale(saved);
  }, []);

  useEffect(() => {
    i18n.activate(locale);
    document.documentElement.lang = locale;
    localStorage.setItem("locale", locale);
  }, [locale]);

  return (
    <I18nProvider i18n={i18n}>
      {children}
    </I18nProvider>
  );
}

export function useLocale() {
  const [locale, setLocaleState] = useState(i18n.locale);
  const setLocale = (l: string) => {
    setLocaleState(l);
    i18n.activate(l);
    document.documentElement.lang = l;
    localStorage.setItem("locale", l);
  };
  return { locale, setLocale };
}
