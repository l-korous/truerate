"use client";

import { useEffect, useState } from "react";
import { api, clearToken, type Benefit, type Program, type PublicUser } from "@/lib/api";
import { AddMembership } from "./AddMembership";
import { MemberPerks } from "./DemoSearch";
import { MembershipDetail } from "./MembershipDetail";

function benefitLines(benefits: Benefit[]): string[] {
  const out: string[] = [];
  for (const b of benefits) {
    const v = b.value;
    if (v.kind === "percentDiscount" && v.percentOff) out.push(`${Math.round(v.percentOff * 100)}% off`);
    else if (v.kind === "fixedDiscount" && v.amountOff) out.push(`${v.amountOff} off`);
    else if (v.kind === "pointsEarn") out.push("Earns points/miles");
    for (const p of v.perks ?? []) out.push(p);
  }
  return [...new Set(out)];
}

export function Dashboard({ user: initial, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const [user, setUser] = useState(initial);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programsError, setProgramsError] = useState(false);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"memberships" | "try">("memberships");
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);

  useEffect(() => {
    setProgramsLoading(true);
    api.programs()
      .then(setPrograms)
      .catch(() => setProgramsError(true))
      .finally(() => setProgramsLoading(false));
  }, []);

  async function remove(id: string) {
    setUser(await api.removeMembership(id));
    if (selectedMembershipId === id) setSelectedMembershipId(null);
  }

  const selectedMembership = selectedMembershipId
    ? user.memberships.find((m) => m.id === selectedMembershipId) ?? null
    : null;

  const selectedProgram = selectedMembership?.programId
    ? programs.find((p) => p.id === selectedMembership.programId)
    : undefined;

  return (
    <div className="min-h-screen bg-grain">
      <header className="border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-display text-xl"><span className="h-2 w-2 rounded-full bg-save" /> TrueRate</div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-muted">{user.email}</span>
            <button className="text-sm text-ink-muted underline-offset-4 hover:underline"
              onClick={() => { clearToken(); onSignOut(); }}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Tabs — hidden when viewing a detail */}
        {!selectedMembership && (
          <div className="mb-8 flex gap-1 rounded-xl bg-white p-1 shadow-sm" style={{ width: "fit-content" }}>
            {([["memberships", "Memberships"], ["try", "Try it"]] as const).map(([k, label]) => (
              <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition ${tab === k ? "bg-ink text-paper" : "text-ink-muted"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Membership detail view */}
        {selectedMembership ? (
          <MembershipDetail
            membership={selectedMembership}
            program={selectedProgram}
            onBack={() => setSelectedMembershipId(null)}
            onRemove={() => remove(selectedMembership.id)}
          />
        ) : tab === "memberships" ? (
          <section>
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h1 className="font-display text-3xl text-ink">Your memberships</h1>
                <p className="mt-1 text-ink-muted">The more complete this is, the more TrueRate can find for you.</p>
              </div>
              <button className="btn-primary" data-testid="add-membership" onClick={() => setAdding(true)}>+ Add</button>
            </div>

            {programsError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                Could not load program catalog — some details may be unavailable.
              </div>
            )}

            {user.memberships.length === 0 ? (
              <div className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center">
                <p className="font-display text-xl text-ink">Nothing here yet</p>
                <p className="mx-auto mt-2 max-w-sm text-ink-muted">
                  Add a membership — Booking Genius, Marriott, a card perk — or a negotiated rate at a specific hotel.
                </p>
                <button className="btn-primary mt-6" onClick={() => setAdding(true)}>Add a membership</button>
              </div>
            ) : (
              <ul className="space-y-3" data-testid="membership-list">
                {user.memberships.map((m) => {
                  const lines = benefitLines(m.benefits);
                  return (
                    <li key={m.id}
                      className="flex cursor-pointer items-start justify-between rounded-xl2 border border-line bg-card p-5 transition hover:border-ink/30 hover:bg-white"
                      onClick={() => setSelectedMembershipId(m.id)}
                      data-testid={`membership-item-${m.id}`}
                    >
                      <div>
                        <p className="font-medium text-ink">{m.label}</p>
                        {m.tier && (
                          <p className="mt-0.5 text-xs font-medium text-ink-muted">{m.tier}</p>
                        )}
                        {lines.length > 0 && (
                          <p className="mt-1 text-sm text-ink-muted">{lines.join(" · ")}</p>
                        )}
                        <p className="mt-1 text-xs">
                          <span className={m.status === "active" ? "text-save" : m.status === "invalid" ? "text-red-600" : "text-points"}>
                            {m.status}
                          </span>
                          {m.programId ? " · from catalog" : " · custom"}
                          {m.hasCredential ? " · credential stored (encrypted)" : ""}
                        </p>
                      </div>
                      <button
                        className="text-sm text-ink-muted hover:text-red-600"
                        onClick={(e) => { e.stopPropagation(); remove(m.id); }}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <section>
            <div className="mb-6">
              <h1 className="font-display text-3xl text-ink">Your perks &amp; discounts</h1>
              <p className="mt-1 text-ink-muted">
                Discounts and perks that apply from your memberships — connect the MCP server or browser extension to use them automatically.
              </p>
            </div>
            {programsLoading ? (
              <p className="text-ink-muted text-sm">Loading…</p>
            ) : (
              <MemberPerks user={user} />
            )}
          </section>
        )}
      </main>

      {adding && (
        <AddMembership programs={programs} onClose={() => setAdding(false)}
          onAdded={(u) => { setUser(u); setAdding(false); }} />
      )}
    </div>
  );
}
