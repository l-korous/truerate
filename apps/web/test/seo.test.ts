import { test } from "node:test";
import assert from "node:assert/strict";
import { locales, defaultLocale, siteMetadata, hreflangTags } from "../lib/i18n";
import {
  siteUrl,
  getLocaleUrl,
  buildAlternateLanguages,
  buildPageMetadata,
  buildNoindexMetadata,
  organizationJsonLd,
  websiteJsonLd,
  softwareApplicationJsonLd,
} from "../lib/seo";

// ── i18n: locale config ──────────────────────────────────────────────────────

test("locales: includes all required locales", () => {
  for (const locale of ["en", "cs", "de", "pl", "sk", "hu", "de-AT"]) {
    assert.ok(locales.includes(locale as never), `missing locale: ${locale}`);
  }
});

test("locales: defaultLocale is en", () => {
  assert.equal(defaultLocale, "en");
});

test("siteMetadata: every locale has title, description, ogDescription", () => {
  for (const locale of locales) {
    const meta = siteMetadata[locale];
    assert.ok(meta.title.length > 0, `${locale}: missing title`);
    assert.ok(meta.description.length > 0, `${locale}: missing description`);
    assert.ok(meta.ogDescription.length > 0, `${locale}: missing ogDescription`);
  }
});

test("siteMetadata: no locale computes or returns prices (final price, discounted price, etc.)", () => {
  // Per product rule #1: CustomRates never computes or returns prices.
  // Metadata may mention that CustomRates does NOT touch prices ("without touching prices").
  // Forbidden: implying CustomRates returns or computes a final/discounted/indicative price.
  const forbiddenTerms = /final price|discounted price|member price|indicative price|from \$|from €/i;
  for (const locale of locales) {
    const { title, description, ogDescription } = siteMetadata[locale];
    for (const [field, val] of [
      ["title", title],
      ["description", description],
      ["ogDescription", ogDescription],
    ] as [string, string][]) {
      assert.ok(
        !forbiddenTerms.test(val),
        `${locale}.${field} must not imply price computation: "${val}"`,
      );
    }
  }
});

test("hreflangTags: every locale has a BCP-47 tag", () => {
  for (const locale of locales) {
    assert.ok(hreflangTags[locale], `${locale}: missing hreflang tag`);
  }
});

// ── seo: URL helpers ─────────────────────────────────────────────────────────

test("getLocaleUrl: defaultLocale returns siteUrl", () => {
  assert.equal(getLocaleUrl("en"), siteUrl);
});

test("getLocaleUrl: non-default locale prefixes with locale", () => {
  assert.equal(getLocaleUrl("cs"), `${siteUrl}/cs`);
  assert.equal(getLocaleUrl("de-AT"), `${siteUrl}/de-AT`);
});

test("getLocaleUrl: appends path correctly", () => {
  assert.equal(getLocaleUrl("en", "/about"), `${siteUrl}/about`);
  assert.equal(getLocaleUrl("de", "/about"), `${siteUrl}/de/about`);
});

// ── seo: alternate languages ─────────────────────────────────────────────────

test("buildAlternateLanguages: returns entry for every locale", () => {
  const alts = buildAlternateLanguages();
  for (const locale of locales) {
    const tag = hreflangTags[locale];
    assert.ok(tag in alts, `missing alternate for ${locale} (tag: ${tag})`);
  }
});

test("buildAlternateLanguages: en points to siteUrl", () => {
  const alts = buildAlternateLanguages();
  assert.equal(alts["en"], siteUrl);
});

test("buildAlternateLanguages: cs points to siteUrl/cs", () => {
  const alts = buildAlternateLanguages();
  assert.equal(alts["cs"], `${siteUrl}/cs`);
});

// ── seo: buildPageMetadata ────────────────────────────────────────────────────

test("buildPageMetadata: en includes OG tags", () => {
  const meta = buildPageMetadata("en");
  assert.ok(meta.openGraph, "missing openGraph");
  const og = meta.openGraph as Record<string, unknown>;
  assert.equal(og["type"], "website");
  assert.ok(og["title"], "missing og:title");
  assert.ok(og["description"], "missing og:description");
  assert.equal(og["siteName"], "CustomRates");
});

test("buildPageMetadata: en includes Twitter card", () => {
  const meta = buildPageMetadata("en");
  assert.ok(meta.twitter, "missing twitter card");
  const tw = meta.twitter as Record<string, unknown>;
  assert.equal(tw["card"], "summary_large_image");
});

test("buildPageMetadata: en includes canonical and x-default alternates", () => {
  const meta = buildPageMetadata("en");
  assert.ok(meta.alternates?.canonical, "missing canonical");
  const langs = meta.alternates?.languages as Record<string, string> | undefined;
  assert.ok(langs?.["x-default"], "missing x-default");
  assert.equal(langs!["x-default"], siteUrl);
});

test("buildPageMetadata: cs uses Czech metadata", () => {
  const meta = buildPageMetadata("cs");
  const title = meta.title;
  if (title === null || title === undefined) {
    assert.fail("cs title should not be null");
  } else if (typeof title === "string") {
    assert.ok(title.length > 0, "cs should have a non-empty title");
  } else {
    const defaultTitle = (title as { default?: string }).default;
    assert.ok(typeof defaultTitle === "string" && defaultTitle.length > 0, "cs should have a title");
  }
});

test("buildPageMetadata: robots index=true for public pages", () => {
  const meta = buildPageMetadata("en");
  assert.deepEqual(meta.robots, { index: true, follow: true });
});

// ── seo: buildNoindexMetadata ─────────────────────────────────────────────────

test("buildNoindexMetadata: robots index=false", () => {
  const meta = buildNoindexMetadata("Admin");
  assert.deepEqual(meta.robots, { index: false, follow: false });
  assert.equal(meta.title, "Admin");
});

// ── seo: JSON-LD ──────────────────────────────────────────────────────────────

test("organizationJsonLd: required schema.org fields present", () => {
  assert.equal(organizationJsonLd["@context"], "https://schema.org");
  assert.equal(organizationJsonLd["@type"], "Organization");
  assert.ok(organizationJsonLd.name, "missing name");
  assert.ok(organizationJsonLd.url, "missing url");
  assert.ok(organizationJsonLd.description, "missing description");
});

test("organizationJsonLd: no price computation or return claims", () => {
  const json = JSON.stringify(organizationJsonLd);
  const forbidden = /final price|discounted price|member price|indicative price/i;
  assert.ok(!forbidden.test(json), "Organization JSON-LD must not imply price computation");
});

test("websiteJsonLd: required schema.org fields present", () => {
  assert.equal(websiteJsonLd["@context"], "https://schema.org");
  assert.equal(websiteJsonLd["@type"], "WebSite");
  assert.ok(websiteJsonLd.name, "missing name");
  assert.ok(websiteJsonLd.url, "missing url");
});

test("softwareApplicationJsonLd: required schema.org fields present", () => {
  assert.equal(softwareApplicationJsonLd["@context"], "https://schema.org");
  assert.equal(softwareApplicationJsonLd["@type"], "SoftwareApplication");
  assert.equal(softwareApplicationJsonLd.applicationCategory, "TravelApplication");
  assert.ok(softwareApplicationJsonLd.operatingSystem, "missing operatingSystem");
});

test("softwareApplicationJsonLd: no price offers (CustomRates never handles prices)", () => {
  assert.ok(
    !("offers" in softwareApplicationJsonLd),
    "softwareApplicationJsonLd must not contain offers/price fields",
  );
});
