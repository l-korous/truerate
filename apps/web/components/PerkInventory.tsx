"use client";

import { useEffect, useState } from "react";
import { api, type PublicUser, type PerkEstimates } from "@/lib/api";

type GroupBy = "program" | "type";

interface PerkItem {
  id: string;
  perkType: string | null;
  label: string;
  conditions?: Record<string, unknown>;
  membershipId: string;
  membershipLabel: string;
  programId?: string;
}

export function pretty(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatConditions(c: Record<string, unknown>): string[] {
  const tags: string[] = [];
  if (c.tierRequired) tags.push(`${c.tierRequired} tier required`);
  if (typeof c.minNights === "number") tags.push(`${c.minNights}+ nights`);
  if (Array.isArray(c.bookingChannel)) {
    tags.push((c.bookingChannel as string[]).map(pretty).join(" / ") + " booking");
  }
  if (c.subjectToAvailability) tags.push("Subject to availability");
  if (c.enrollmentRequired) tags.push("Enrollment required");
  if (typeof c.notes === "string" && c.notes) tags.push(c.notes);
  return tags;
}

export function aggregatePerks(memberships: PublicUser["memberships"]): PerkItem[] {
  const items: PerkItem[] = [];
  for (const m of memberships) {
    for (const benefit of m.benefits) {
      if (benefit.value.kind !== "perk") continue;
      const v = benefit.value;
      if (v.structuredPerks && v.structuredPerks.length > 0) {
        for (const sp of v.structuredPerks) {
          items.push({
            id: `${m.id}-${benefit.id}-${sp.type}`,
            perkType: sp.type,
            label: sp.label,
            conditions: sp.conditions as Record<string, unknown> | undefined,
            membershipId: m.id,
            membershipLabel: m.label,
            programId: m.programId,
          });
        }
      } else {
        for (const p of v.perks ?? []) {
          items.push({
            id: `${m.id}-${benefit.id}-${p}`,
            perkType: null,
            label: p,
            membershipId: m.id,
            membershipLabel: m.label,
            programId: m.programId,
          });
        }
      }
    }
  }
  return items;
}

function EstimateRow({ perkType, estimates }: { perkType: string; estimates: PerkEstimates | null }) {
  if (!estimates) return null;
  const bands = estimates[perkType];
  if (!bands) return null;
  const parts: string[] = [];
  if (bands[3].estimatedUsd > 0) parts.push(`$${bands[3].estimatedUsd} at 3★`);
  if (bands[4].estimatedUsd > 0) parts.push(`$${bands[4].estimatedUsd} at 4★`);
  if (bands[5].estimatedUsd > 0) parts.push(`$${bands[5].estimatedUsd} at 5★`);
  if (parts.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs" data-testid="estimate-row">
      <span className="font-medium text-points">Estimated value</span>
      <span className="text-ink-muted"> ≈ {parts.join(" / ")}</span>
    </p>
  );
}

export function PerkInventory({ user }: { user: PublicUser }) {
  const [estimates, setEstimates] = useState<PerkEstimates | null>(null);
  const [estimatesError, setEstimatesError] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("program");
  const [filterProgram, setFilterProgram] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  useEffect(() => {
    api.perkEstimates().then(setEstimates).catch(() => setEstimatesError(true));
  }, []);

  if (user.memberships.length === 0) {
    return (
      <div
        className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center"
        data-testid="inventory-empty"
      >
        <p className="font-display text-xl text-ink">No memberships yet</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Add memberships on the Memberships tab to build your perk inventory.
        </p>
      </div>
    );
  }

  const allItems = aggregatePerks(user.memberships);

  if (allItems.length === 0) {
    return (
      <div
        className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center"
        data-testid="inventory-no-perks"
      >
        <p className="font-display text-xl text-ink">No perks on file</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Your memberships don&apos;t have any perks recorded yet.
        </p>
      </div>
    );
  }

  const programs = [
    ...new Map(
      allItems.map((i) => [i.membershipId, i.membershipLabel]),
    ).entries(),
  ];
  const types = [
    ...new Set(allItems.filter((i) => i.perkType).map((i) => i.perkType as string)),
  ];

  const filtered = allItems.filter((item) => {
    if (filterProgram !== "all" && item.membershipId !== filterProgram) return false;
    if (filterType !== "all" && item.perkType !== filterType) return false;
    return true;
  });

  type Group = { key: string; label: string; items: PerkItem[] };
  const groups: Group[] = [];
  if (groupBy === "program") {
    const map = new Map<string, Group>();
    for (const item of filtered) {
      if (!map.has(item.membershipId)) {
        map.set(item.membershipId, { key: item.membershipId, label: item.membershipLabel, items: [] });
      }
      map.get(item.membershipId)!.items.push(item);
    }
    groups.push(...map.values());
  } else {
    const map = new Map<string, Group>();
    for (const item of filtered) {
      const key = item.perkType ?? "__other";
      const label = item.perkType ? pretty(item.perkType) : "Other perks";
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key)!.items.push(item);
    }
    groups.push(...map.values());
  }

  return (
    <div data-testid="perk-inventory">
      {estimatesError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Perk value estimates unavailable — conditions and types are still shown.
        </div>
      )}

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Group by</span>
          <div className="flex gap-1 rounded-lg bg-white p-0.5 ring-1 ring-line">
            {(["program", "type"] as const).map((g) => (
              <button
                key={g}
                data-testid={`group-by-${g}`}
                onClick={() => setGroupBy(g)}
                className={`rounded-md px-3 py-1 text-sm transition ${groupBy === g ? "bg-ink text-paper" : "text-ink-muted"}`}
              >
                {g === "program" ? "Program" : "Perk type"}
              </button>
            ))}
          </div>
        </div>

        {programs.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-ink-muted" htmlFor="filter-program">Program</label>
            <select
              id="filter-program"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink"
              value={filterProgram}
              onChange={(e) => setFilterProgram(e.target.value)}
              data-testid="filter-program"
            >
              <option value="all">All</option>
              {programs.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {types.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-ink-muted" htmlFor="filter-type">Type</label>
            <select
              id="filter-type"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              data-testid="filter-type"
            >
              <option value="all">All</option>
              {types.map((t) => (
                <option key={t} value={t}>{pretty(t)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="inventory-no-results">
          No perks match the selected filter.
        </p>
      ) : (
        <div className="space-y-6" data-testid="inventory-groups">
          {groups.map((group) => (
            <section key={group.key} data-testid="inventory-group">
              <h2 className="mb-3 font-display text-lg text-ink">{group.label}</h2>
              <ul className="space-y-2">
                {group.items.map((item) => {
                  const condTags = item.conditions ? formatConditions(item.conditions) : [];
                  return (
                    <li
                      key={item.id}
                      className="rounded-xl border border-line bg-card px-4 py-3"
                      data-testid="inventory-item"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="font-medium text-ink">{item.label}</p>
                          {groupBy !== "program" && (
                            <p className="text-xs text-ink-muted">{item.membershipLabel}</p>
                          )}
                          {condTags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {condTags.map((tag, i) => (
                                <span
                                  key={i}
                                  className="rounded-full bg-grain px-2 py-0.5 text-xs text-ink-muted"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.perkType && (
                            <EstimateRow perkType={item.perkType} estimates={estimates} />
                          )}
                        </div>
                        {item.perkType && (
                          <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted ring-1 ring-line">
                            {pretty(item.perkType)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-muted" data-testid="inventory-disclaimer">
        Estimated values (≈) are illustrative only — not prices or guarantees.
        Actual perk availability depends on conditions shown above.
      </p>
    </div>
  );
}
