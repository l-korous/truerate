"use client";

import { useEffect, useState } from "react";
import { api, type PublicUser, type PerkEstimates } from "@/lib/api";
import { aggregatePerks, pretty } from "./PerkInventory";

export interface MembershipRollup {
  membershipId: string;
  membershipLabel: string;
  total3: number;
  total4: number;
  total5: number;
}

export interface TopPerk {
  perkType: string;
  label: string;
  membershipLabel: string;
  est3: number;
  est4: number;
  est5: number;
}

export interface ValueRollup {
  grand3: number;
  grand4: number;
  grand5: number;
  byMembership: MembershipRollup[];
  topPerks: TopPerk[];
}

export function computeValueRollup(
  memberships: PublicUser["memberships"],
  estimates: PerkEstimates,
): ValueRollup {
  const items = aggregatePerks(memberships);

  const byMembershipMap = new Map<string, MembershipRollup>();
  const perkTotals: TopPerk[] = [];

  for (const item of items) {
    if (!item.perkType) continue;
    const bands = estimates[item.perkType];
    if (!bands) continue;

    const est3 = bands[3].estimatedUsd;
    const est4 = bands[4].estimatedUsd;
    const est5 = bands[5].estimatedUsd;

    if (!byMembershipMap.has(item.membershipId)) {
      byMembershipMap.set(item.membershipId, {
        membershipId: item.membershipId,
        membershipLabel: item.membershipLabel,
        total3: 0,
        total4: 0,
        total5: 0,
      });
    }
    const row = byMembershipMap.get(item.membershipId)!;
    row.total3 += est3;
    row.total4 += est4;
    row.total5 += est5;

    if (est3 > 0 || est4 > 0 || est5 > 0) {
      perkTotals.push({
        perkType: item.perkType,
        label: item.label,
        membershipLabel: item.membershipLabel,
        est3,
        est4,
        est5,
      });
    }
  }

  perkTotals.sort((a, b) => b.est5 - a.est5 || b.est4 - a.est4 || b.est3 - a.est3);

  const byMembership = [...byMembershipMap.values()];
  const grand3 = byMembership.reduce((s, r) => s + r.total3, 0);
  const grand4 = byMembership.reduce((s, r) => s + r.total4, 0);
  const grand5 = byMembership.reduce((s, r) => s + r.total5, 0);

  return { grand3, grand4, grand5, byMembership, topPerks: perkTotals.slice(0, 5) };
}

function BandCard({
  stars,
  total,
  label,
}: {
  stars: string;
  total: number;
  label: string;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-xl2 border border-line bg-card p-5 text-center"
      data-testid={`band-card-${stars}`}
    >
      <span className="mb-1 text-sm text-ink-muted">{label}</span>
      <span className="font-display text-3xl text-ink" data-testid={`band-total-${stars}`}>
        ≈${total}
      </span>
      <span className="mt-1 text-xs text-ink-muted">per stay, estimated</span>
    </div>
  );
}

export function ValueExplainer({
  user,
  onViewInventory,
}: {
  user: PublicUser;
  onViewInventory?: () => void;
}) {
  const [estimates, setEstimates] = useState<PerkEstimates | null>(null);
  const [estimatesError, setEstimatesError] = useState(false);

  useEffect(() => {
    api.perkEstimates().then(setEstimates).catch(() => setEstimatesError(true));
  }, []);

  if (user.memberships.length === 0) {
    return (
      <div
        className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center"
        data-testid="value-explainer-empty"
      >
        <p className="font-display text-xl text-ink">No memberships yet</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Add memberships on the Memberships tab to see what your vault is worth.
        </p>
      </div>
    );
  }

  const allItems = aggregatePerks(user.memberships);
  const hasTypedPerks = allItems.some((i) => i.perkType);

  if (!hasTypedPerks) {
    return (
      <div
        className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center"
        data-testid="value-explainer-no-perks"
      >
        <p className="font-display text-xl text-ink">No estimable perks on file</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Your memberships don&apos;t have any perks with known value estimates yet.
        </p>
      </div>
    );
  }

  if (!estimates) {
    if (estimatesError) {
      return (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
          data-testid="value-explainer-error"
        >
          Could not load perk value estimates. Please try again later.
        </div>
      );
    }
    return (
      <p className="text-sm text-ink-muted" data-testid="value-explainer-loading">
        Loading estimates…
      </p>
    );
  }

  const rollup = computeValueRollup(user.memberships, estimates);

  return (
    <div data-testid="value-explainer">
      {/* Grand totals */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="value-band-cards">
        <BandCard stars="3" total={rollup.grand3} label="Budget hotel (3★)" />
        <BandCard stars="4" total={rollup.grand4} label="Mid-range hotel (4★)" />
        <BandCard stars="5" total={rollup.grand5} label="Luxury hotel (5★)" />
      </div>

      {/* Per-membership breakdown */}
      {rollup.byMembership.length > 1 && (
        <section className="mb-8" data-testid="value-by-membership">
          <h2 className="mb-3 font-display text-lg text-ink">By membership</h2>
          <ul className="space-y-2">
            {rollup.byMembership.map((row) => (
              <li
                key={row.membershipId}
                className="flex flex-col gap-1 rounded-xl border border-line bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="value-membership-row"
              >
                <span className="font-medium text-ink">{row.membershipLabel}</span>
                <span className="text-sm text-ink-muted" data-testid="value-membership-totals">
                  ≈${row.total3} / ${row.total4} / ${row.total5}
                  <span className="ml-1 text-xs">(3★ / 4★ / 5★)</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Top perks */}
      {rollup.topPerks.length > 0 && (
        <section className="mb-8" data-testid="value-top-perks">
          <h2 className="mb-3 font-display text-lg text-ink">Top-value perks</h2>
          <ul className="space-y-2">
            {rollup.topPerks.map((p, i) => (
              <li
                key={`${p.perkType}-${p.membershipLabel}-${i}`}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
                data-testid="value-top-perk"
              >
                <div>
                  <p className="font-medium text-ink">{p.label}</p>
                  <p className="text-xs text-ink-muted">{p.membershipLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-points">
                    ≈${p.est5} at 5★
                  </p>
                  <p className="text-xs text-ink-muted">
                    ${p.est3} / ${p.est4} at 3★ / 4★
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Methodology explanation */}
      <section
        className="mb-6 rounded-xl border border-line bg-white/60 px-5 py-4"
        data-testid="value-methodology"
      >
        <h2 className="mb-2 font-display text-base text-ink">How we estimate</h2>
        <p className="text-sm text-ink-muted">
          Each perk type (e.g. free breakfast, room upgrade) has a curated estimate of its{" "}
          <strong>replacement cost</strong> at 3★, 4★, and 5★ hotels — based on published hotel
          fee schedules and industry surveys. We add up the estimates across all your perks to give
          you a sense of the total potential value per stay.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          These are <strong>estimates only</strong> — not prices, not guarantees. Actual perk
          availability depends on conditions, dates, and booking channel. The numbers help you
          compare memberships and understand which perks are most valuable, not book a hotel.
        </p>
      </section>

      {/* Link to full inventory */}
      {onViewInventory && (
        <button
          className="text-sm font-medium text-ink underline-offset-2 hover:underline"
          onClick={onViewInventory}
          data-testid="value-view-inventory"
        >
          See your full perk inventory →
        </button>
      )}

      <p className="mt-4 text-xs text-ink-muted" data-testid="value-disclaimer">
        Estimated values (≈) are illustrative only — not prices or guarantees. TrueRate never
        handles prices; estimates reflect perk replacement cost, not what you pay or save.
      </p>
    </div>
  );
}
