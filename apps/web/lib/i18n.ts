export const locales = ["en", "cs", "de", "pl", "sk", "hu", "de-AT"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const hreflangTags: Record<Locale, string> = {
  en: "en",
  cs: "cs",
  de: "de",
  pl: "pl",
  sk: "sk",
  hu: "hu",
  "de-AT": "de-AT",
};

export type SiteMetadata = {
  title: string;
  description: string;
  ogDescription: string;
};

export const siteMetadata: Record<Locale, SiteMetadata> = {
  en: {
    title: "CustomRates — your travel memberships, all in one place",
    description:
      "Keep all your loyalty memberships and perks in one place. CustomRates shows which discounts, perks, and conditions apply for any hotel — without ever touching prices.",
    ogDescription:
      "Your loyalty memberships unlock perks the anonymous web never shows you. CustomRates puts them all in one place.",
  },
  cs: {
    title: "CustomRates — vaše cestovní členství na jednom místě",
    description:
      "Mějte všechna věrnostní členství a výhody na jednom místě. CustomRates vám ukáže, které slevy, výhody a podmínky platí pro každý hotel — bez jakéhokoli zasahování do cen.",
    ogDescription:
      "Vaše věrnostní členství odemykají výhody, které anonymní web nikdy neukáže. CustomRates je dává na jedno místo.",
  },
  de: {
    title: "CustomRates — Ihre Reisemitgliedschaften an einem Ort",
    description:
      "Behalten Sie alle Treuemitgliedschaften und Vorteile an einem Ort im Blick. CustomRates zeigt, welche Rabatte, Vorteile und Konditionen für jedes Hotel gelten — ohne Preise zu berühren.",
    ogDescription:
      "Ihre Treuemitgliedschaften eröffnen Vorteile, die das anonyme Web nie zeigt. CustomRates bündelt sie an einem Ort.",
  },
  pl: {
    title: "CustomRates — wszystkie Twoje członkostwa podróżne w jednym miejscu",
    description:
      "Miej wszystkie programy lojalnościowe i korzyści w jednym miejscu. CustomRates pokazuje, jakie rabaty, przywileje i warunki obowiązują dla każdego hotelu — bez ingerowania w ceny.",
    ogDescription:
      "Twoje programy lojalnościowe odblokowują korzyści, których anonimowy web nigdy nie pokazuje. CustomRates zbiera je w jednym miejscu.",
  },
  sk: {
    title: "CustomRates — vaše cestovné členstvá na jednom mieste",
    description:
      "Majte všetky vernostné členstvá a výhody na jednom mieste. CustomRates vám ukáže, ktoré zľavy, výhody a podmienky platia pre každý hotel — bez akéhokoľvek zasahovania do cien.",
    ogDescription:
      "Vaše vernostné členstvá odomykajú výhody, ktoré anonymný web nikdy neukáže. CustomRates ich dáva na jedno miesto.",
  },
  hu: {
    title: "CustomRates — összes utazási tagságod egy helyen",
    description:
      "Tartsd nyilván az összes hűségprogramodat és juttatásodat egy helyen. A CustomRates megmutatja, melyik kedvezmény, juttatás és feltétel érvényes minden szállodára — az árakat soha nem érinti.",
    ogDescription:
      "Hűségprogramjaid olyan juttatásokat nyitnak meg, amelyeket az anonim web soha nem mutat. A CustomRates egy helyre gyűjti őket.",
  },
  "de-AT": {
    title: "CustomRates — Ihre Reisemitgliedschaften an einem Ort",
    description:
      "Behalten Sie alle Treuemitgliedschaften und Vorteile an einem Ort im Blick. CustomRates zeigt, welche Rabatte, Vorteile und Konditionen für jedes Hotel in Österreich gelten — ohne Preise zu berühren.",
    ogDescription:
      "Ihre Treuemitgliedschaften eröffnen Vorteile, die das anonyme Web nie zeigt. CustomRates bündelt sie an einem Ort.",
  },
};
