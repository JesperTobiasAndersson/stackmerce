import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";

import { createTranslator, type Locale, type Translate } from "./index";

/** Loader data exposed by `app/routes/app.tsx` for every embedded page. */
interface AppRouteData {
  locale?: Locale;
}

export function useLocale(): Locale {
  const data = useRouteLoaderData("routes/app") as AppRouteData | undefined;

  return data?.locale ?? "en";
}

export function useTranslation(): { t: Translate; locale: Locale } {
  const locale = useLocale();
  const t = useMemo(() => createTranslator(locale), [locale]);

  return { t, locale };
}
