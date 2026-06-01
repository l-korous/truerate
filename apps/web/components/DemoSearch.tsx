"use client";

import { useEffect, useState } from "react";
import { api, type PublicUser, type PerkEstimates } from "@/lib/api";

function pretty(id: string) { return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

function PerkEstimateTag({ perkType, estimates }: { perkType: string; estimates: PerkEstimates | null }) {
  if (!estimates) return null;
  const bands = estimates[perkType];
  if (!bands) return null;

  const parts: string[] = [];
  if (bands[3].estimatedUsd > 0) parts.push(`$${bands[3].estimatedUsd} (3★)`);
  if (bands[4].estimatedUsd > 0) parts.push(`$${bands[4].estimatedUsd} (4★)`);
  if (bands[5].estimatedUsd > 0) parts.push(`$${bands[5].estimatedUsd} (5★)`);

  if (parts.length === 0) return null;

  return (
    <span className="ml-2 text-xs text-ink-muted" title="Estimated value — not a price">
      ≈ {parts.join(" / ")}
    </span>
  );
}

export function MemberPerks({ user }: { user: PublicUser }) {
  const [estimates, setEstimates] = useState<PerkEstimates | null>(null);

  useEffect(() => {
    api.perkEstimates().then(setEstimates).catch(() => null);
  }, []);

  if (user.memberships.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center">
        <p className="font-display text-xl text-ink">No memberships yet</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Add memberships on the Memberships tab to see which discounts and perks apply to your stays.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {user.memberships.map((m) => {
        const benefitRows: { line: string; perkType?: string; scope: string }[] = m.benefits.flatMap((b) => {
          const rows: { line: string; perkType?: string; scope: string }[] = [];
          const v = b.value;
          if (v.kind === "percentDiscount" && v.percentOff) {
            rows.push({ line: `${Math.round(v.percentOff * 100)}% off`, scope: b.scope });
          }
          // Prefer structuredPerks when available for richer display
          if (v.structuredPerks && v.structuredPerks.length > 0) {
            for (const sp of v.structuredPerks) {
              rows.push({ line: sp.label, perkType: sp.type, scope: b.scope });
            }
          } else {
            for (const p of v.perks ?? []) {
              rows.push({ line: p, scope: b.scope });
            }
          }
          if (v.conditions) rows.push({ line: `Conditions: ${v.conditions}`, scope: b.scope });
          return rows;
        });

        return (
          <div key={m.id} className="rounded-xl2 border border-line bg-card p-5" data-testid="perk-card">
            <p className="font-medium text-ink">{m.label}</p>
            {m.programId && <p className="text-xs text-ink-muted">{pretty(m.programId)}</p>}
            {benefitRows.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {benefitRows.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-save" />
                    <span className="text-ink">{b.line}</span>
                    {b.perkType && <PerkEstimateTag perkType={b.perkType} estimates={estimates} />}
                    {b.scope !== "global" && <span className="text-xs text-ink-muted">({b.scope})</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No specific discounts or perks on file.</p>
            )}
          </div>
        );
      })}
      <p className="mt-4 text-xs text-ink-muted" data-testid="perks-note">
        Discounts (%) and perks shown are exact from your membership catalog. Estimated perk values (≈) are illustrative and not prices. Connect the MCP server or browser extension to apply these automatically when searching hotels.
      </p>
    </div>
  );
}
