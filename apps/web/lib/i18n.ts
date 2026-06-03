import en from "../messages/en.json";
import cs from "../messages/cs.json";
import de from "../messages/de.json";
import pl from "../messages/pl.json";
import sk from "../messages/sk.json";
import hu from "../messages/hu.json";
import deAT from "../messages/de-AT.json";

type Messages = typeof en;
export type MessageKey = keyof Messages;

const catalogs: Record<string, Messages> = {
  en,
  cs,
  de,
  pl,
  sk,
  hu,
  "de-AT": deAT,
};

function detectLocale(): string {
  if (typeof window === "undefined") return "en";
  const lang = navigator.language ?? "en";
  if (lang in catalogs) return lang;
  const base = lang.split("-")[0]!;
  if (base in catalogs) return base;
  return "en";
}

function getMessages(): Messages {
  const locale = detectLocale();
  return catalogs[locale] ?? en;
}

/** Translate a message key, interpolating {placeholders} from params. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const msgs = getMessages();
  let str: string = msgs[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/** Same as t() but returns the result for a specific locale (for tests / SSR). */
export function tLocale(locale: string, key: MessageKey, params?: Record<string, string | number>): string {
  const msgs = catalogs[locale] ?? en;
  let str: string = (msgs as Messages)[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
