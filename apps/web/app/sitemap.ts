import type { MetadataRoute } from "next";
import { locales, defaultLocale, type Locale } from "@/lib/i18n";
import { getLocaleUrl, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return locales.map((locale) => {
    const url = getLocaleUrl(locale as Locale);
    const alternates = Object.fromEntries(
      locales.map((l) => [l === defaultLocale ? "en" : l, getLocaleUrl(l as Locale)]),
    );
    return {
      url,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: locale === defaultLocale ? 1.0 : 0.9,
      alternates: {
        languages: {
          ...alternates,
          "x-default": siteUrl,
        },
      },
    };
  });
}
