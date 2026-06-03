"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { localeDisplayNames } from "@/lib/locale";

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("LanguageSwitcher");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Locale;
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="relative">
      <label htmlFor="language-switcher" className="sr-only">
        {t("label")}
      </label>
      <select
        id="language-switcher"
        data-testid="language-switcher"
        value={locale}
        onChange={handleChange}
        aria-label={t("aria")}
        className="cursor-pointer appearance-none rounded-lg border border-line bg-paper px-3 py-1.5 pr-7 text-sm text-ink-muted transition hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeDisplayNames[l]}
          </option>
        ))}
      </select>
      {/* custom chevron */}
      <span
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ink-muted"
        aria-hidden="true"
      >
        ▾
      </span>
    </div>
  );
}
