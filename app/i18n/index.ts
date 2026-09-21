import { en, sv, type TranslationKey } from "./translations";

export type Locale = "en" | "sv";
export type { TranslationKey };

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, sv };

export const LOCALE_PARAM = "locale";
export const LOCALE_COOKIE = "app_locale";

export type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

/**
 * Shopify Admin passes `?locale=sv-SE` when it loads the app. Later
 * navigations keep the search string, and redirects carry it explicitly; the
 * cookie is a fallback for the few places that lose it.
 */
export function resolveLocale(request: Request): Locale {
  const url = new URL(request.url);
  const fromQuery = normalizeLocale(url.searchParams.get(LOCALE_PARAM));
  if (fromQuery) {
    return fromQuery;
  }

  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([a-z-]+)`, "i"));

  return normalizeLocale(match?.[1]) ?? "en";
}

export function localeCookieHeader(locale: Locale) {
  // The app lives in an iframe on admin.shopify.com, so the cookie must be
  // cross-site. Browsers that block third-party cookies just fall back to
  // English on the rare navigation that drops the query string.
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=None; Secure`;
}

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const language = String(value ?? "").toLowerCase().split(/[-_]/)[0];

  return language === "sv" ? "sv" : language === "en" ? "en" : null;
}

export function createTranslator(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale] ?? en;

  return (key, params = {}) => {
    const template = dictionary[key] ?? en[key] ?? key;

    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  };
}

export function formatMoney(locale: Locale, amount: string | number, currencyCode: string) {
  const value = Number(amount);

  if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(currencyCode)) {
    return `${amount} ${currencyCode}`.trim();
  }

  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${value} ${currencyCode}`;
  }
}

export function formatDate(locale: Locale, iso: string, withYear = false) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleDateString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** Appends the locale to an in-app URL so a redirect keeps the language. */
export function withLocale(url: string, locale: Locale) {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set(LOCALE_PARAM, locale);

  return `${path}?${params.toString()}`;
}

function intlLocale(locale: Locale) {
  return locale === "sv" ? "sv-SE" : "en-US";
}
