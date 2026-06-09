import type { Metadata } from "next";
import { defaultLocale, hreflangTags, locales, siteMetadata, type Locale } from "./i18n";

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://truerate.app";

export function getLocaleUrl(locale: Locale, path = ""): string {
  if (locale === defaultLocale) {
    return `${siteUrl}${path}`;
  }
  return `${siteUrl}/${locale}${path}`;
}

export function buildAlternateLanguages(): Record<string, string> {
  return Object.fromEntries(
    locales.map((locale) => [hreflangTags[locale], getLocaleUrl(locale)]),
  );
}

export function buildPageMetadata(locale: Locale = defaultLocale, path = ""): Metadata {
  const meta = siteMetadata[locale];
  const canonical = getLocaleUrl(locale, path);
  const alternateLanguages = buildAlternateLanguages();

  return {
    title: {
      default: meta.title,
      template: "%s | CustomRates",
    },
    description: meta.description,
    metadataBase: new URL(siteUrl),
    alternates: {
      canonical,
      languages: { ...alternateLanguages, "x-default": siteUrl },
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: meta.title,
      description: meta.ogDescription,
      siteName: "CustomRates",
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.ogDescription,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export function buildNoindexMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "CustomRates",
  url: siteUrl,
  description:
    "CustomRates is a vault of travel loyalty memberships and perks. It shows which discounts, perks, and conditions apply for any hotel — without handling prices.",
  areaServed: ["CZ", "DE", "PL", "AT", "SK", "HU"],
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "CustomRates",
  url: siteUrl,
  description:
    "Keep all your loyalty memberships and perks in one place. CustomRates shows which discounts, perks, and conditions apply for any hotel.",
};

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "CustomRates",
  applicationCategory: "TravelApplication",
  operatingSystem: "Web",
  url: siteUrl,
  description:
    "A web app and MCP server that consolidates travel loyalty memberships and perks, surfacing applicable discounts and conditions without touching prices.",
};
