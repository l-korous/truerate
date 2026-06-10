"use client";

import type { CatalogEntry, BenefitTemplate } from "@/lib/api";

interface Props {
  entry: CatalogEntry;
}

/**
 * Derives the headline discount percent (0-100) from a tier's benefit templates.
 * Returns null if no percent discount is present.
 */
function headlineDiscount(templates: BenefitTemplate[]): number | null {
  for (const t of templates) {
    if (t.value.kind === "percentDiscount" && t.value.percentOff) {
      return Math.round(t.value.percentOff * 100);
    }
  }
  return null;
}

/**
 * Collects human-readable perk labels from a tier's benefit templates.
 */
function collectPerks(templates: BenefitTemplate[]): string[] {
  const out: string[] = [];
  for (const t of templates) {
    if (t.value.perks) out.push(...t.value.perks);
  }
  return [...new Set(out)];
}

/**
 * Produces the guest-facing preview lines for a program entry, exactly as the
 * MCP/extension would surface them:
 *   "Members save X% — book direct at <URL>"
 * or for perk-only:
 *   "Members get: <perk>, <perk> — book direct at <URL>"
 *
 * No prices — X% is a discount, not a price. The consumer does any math.
 */
export function formatGuestPreviewLines(entry: CatalogEntry): string[] {
  const realizationUrl = entry.realizationUrl ?? "";
  const urlLabel = realizationUrl || "(no realization URL set)";
  const tiers = Object.keys(entry.benefits);
  if (tiers.length === 0) return ["(no benefits defined)"];

  const lines: string[] = [];

  for (const tier of tiers) {
    const templates = entry.benefits[tier] ?? [];
    const pct = headlineDiscount(templates);
    const perks = collectPerks(templates);

    const tierLabel = tier === "*" ? "" : ` (${tier})`;

    if (pct !== null) {
      const who = entry.openToAnyone ? "Anyone can" : "Members";
      const verb = entry.openToAnyone ? "register and save" : "save";
      const bookPart = realizationUrl
        ? `book direct at ${realizationUrl}`
        : "book direct";
      lines.push(`${who} ${verb} ${pct}%${tierLabel} — ${bookPart}`);
    } else if (perks.length > 0) {
      const bookPart = realizationUrl
        ? `book direct at ${realizationUrl}`
        : "book direct";
      lines.push(`Members get: ${perks.join(", ")}${tierLabel} — ${bookPart}`);
    }
  }

  return lines.length > 0 ? lines : [`(no discount or perks — ${urlLabel})`];
}

export function GuestPreview({ entry }: Props) {
  const lines = formatGuestPreviewLines(entry);

  return (
    <div className="space-y-4" data-testid="guest-preview">
      <div className="rounded-xl border border-line bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            Guest-facing preview
          </h2>
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 border border-green-200">
            No prices
          </span>
        </div>

        <p className="text-xs text-ink-muted">
          This is how the MCP tool and browser extension surface this program.
          Phrasing guard: discount % is shown, never a final price.
        </p>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div
              key={i}
              className="rounded-lg border border-save/30 bg-save/5 px-4 py-3 text-sm font-medium text-ink"
              data-testid={`preview-line-${i}`}
            >
              {line}
            </div>
          ))}
        </div>

        {entry.realizationUrl && (
          <div className="border-t border-line pt-3">
            <p className="text-xs text-ink-muted">
              Realization URL:{" "}
              <a
                href={entry.realizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2"
              >
                {entry.realizationUrl}
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-card p-6 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          Program summary
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-muted">Name</dt>
          <dd className="text-ink">{entry.name}</dd>
          <dt className="text-ink-muted">Category</dt>
          <dd className="text-ink">{entry.category}</dd>
          <dt className="text-ink-muted">Region</dt>
          <dd className="text-ink">{entry.region}</dd>
          <dt className="text-ink-muted">Open to anyone</dt>
          <dd className="text-ink">{entry.openToAnyone ? "Yes" : "No"}</dd>
          {entry.tiers && entry.tiers.length > 0 && (
            <>
              <dt className="text-ink-muted">Tiers</dt>
              <dd className="text-ink">{entry.tiers.join(", ")}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
