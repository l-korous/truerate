"use client";

import { useEffect, useState } from "react";
import { api, clearToken, type Benefit, type Program, type PublicUser } from "@/lib/api";
import { track } from "@/lib/analytics";
import { AddMembership } from "./AddMembership";
import { EditMembership } from "./EditMembership";
import { MemberPerks } from "./DemoSearch";
import { MembershipDetail } from "./MembershipDetail";
import { PerkInventory } from "./PerkInventory";
import { ValueExplainer } from "./ValueExplainer";

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
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [tab, setTab] = useState<"memberships" | "try" | "inventory" | "value">("memberships");
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    setProgramsLoading(true);
    api.programs()
      .then(setPrograms)
      .catch(() => setProgramsError(true))
      .finally(() => setProgramsLoading(false));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function remove(id: string) {
    setUser(await api.removeMembership(id));
    setConfirmRemoveId(null);
    if (selectedMembershipId === id) setSelectedMembershipId(null);
    showToast("Membership removed");
  }

  const selectedMembership = selectedMembershipId
    ? user.memberships.find((m) => m.id === selectedMembershipId) ?? null
    : null;

  const selectedProgram = selectedMembership?.programId
    ? programs.find((p) => p.id === selectedMembership.programId)
    : undefined;

  const editingMembership = editingMembershipId
    ? user.memberships.find((m) => m.id === editingMembershipId) ?? null
    : null;

  const editingProgram = editingMembership?.programId
    ? programs.find((p) => p.id === editingMembership.programId)
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
            {([["memberships", "Memberships"], ["inventory", "Perk Inventory"], ["value", "Value"], ["try", "Try it"]] as const).map(([k, label]) => (
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
            onEdit={() => setEditingMembershipId(selectedMembership.id)}
          />
        ) : tab === "inventory" ? (
          <section>
            <div className="mb-6">
              <h1 className="font-display text-3xl text-ink">Perk Inventory</h1>
              <p className="mt-1 text-ink-muted">
                All perks across your memberships — with conditions and estimated values. No prices.
              </p>
            </div>
            <PerkInventory user={user} />
          </section>
        ) : tab === "value" ? (
          <section>
            <div className="mb-6">
              <h1 className="font-display text-3xl text-ink">What your memberships are worth</h1>
              <p className="mt-1 text-ink-muted">
                Estimated value of your perks per stay — at 3★, 4★, and 5★ hotels. These are estimates, not prices.
              </p>
            </div>
            <ValueExplainer user={user} onViewInventory={() => setTab("inventory")} />
          </section>
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
                      {confirmRemoveId === m.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="text-sm font-medium text-red-600 hover:text-red-700"
                            data-testid={`list-remove-confirm-${m.id}`}
                            onClick={() => remove(m.id)}
                          >
                            Confirm
                          </button>
                          <button
                            className="text-sm text-ink-muted hover:text-ink"
                            onClick={() => setConfirmRemoveId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="text-sm text-ink-muted hover:text-red-600"
                          data-testid={`list-remove-${m.id}`}
                          onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(m.id); }}
                        >
                          Remove
                        </button>
                      )}
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
          onAdded={(u, kind) => {
            const isFirst = user.memberships.length === 0;
            setUser(u);
            setAdding(false);
            showToast("Membership added");
            track({ name: "membership_added", properties: { is_first: isFirst, kind: kind ?? "catalog" } });
          }} />
      )}

      {editingMembership && (
        <EditMembership
          membership={editingMembership}
          program={editingProgram}
          onClose={() => setEditingMembershipId(null)}
          onSaved={(u) => { setUser(u); setEditingMembershipId(null); setSelectedMembershipId(null); showToast("Membership updated"); }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-ink px-5 py-3 text-sm font-medium text-paper shadow-lg"
          data-testid="toast"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
