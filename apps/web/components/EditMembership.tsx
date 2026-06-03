"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Program, type PublicMembership, type PublicUser } from "@/lib/api";

export function EditMembership({
  membership,
  program,
  onSaved,
  onClose,
}: {
  membership: PublicMembership;
  program?: Program;
  onSaved: (u: PublicUser) => void;
  onClose: () => void;
}) {
  const isCustom = !membership.programId;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [cLabel, setCLabel] = useState(membership.label);
  const [cDomain, setCDomain] = useState(() => membership.benefits[0]?.match.domains?.[0] ?? "");
  const [cKind, setCKind] = useState<"percentDiscount" | "perk">(() => {
    const kind = membership.benefits[0]?.value.kind;
    return kind === "percentDiscount" ? "percentDiscount" : "perk";
  });
  const [cPercent, setCPercent] = useState(() => {
    const off = membership.benefits[0]?.value.percentOff;
    return String(off != null ? Math.round(off * 100) : 15);
  });
  const [cPerks, setCPerks] = useState(() => membership.benefits[0]?.value.perks?.join(", ") ?? "");

  useEffect(() => {
    if (!program) return;
    const seed: Record<string, string> = { ...membership.attributes };
    if (membership.tier) seed["tier"] = membership.tier;
    for (const f of program.fields) {
      if (f.type === "select" && f.options?.length && !seed[f.key]) {
        seed[f.key] = f.options[0]!;
      }
    }
    setValues(seed);
  }, [program, membership]);

  const tier = values["tier"];
  const summary = useMemo(() => {
    if (!program) return [];
    return program.summaryByTier[tier ?? "*"] ?? program.summaryByTier["*"] ?? [];
  }, [program, tier]);

  async function saveCatalog() {
    if (!program) return;
    setBusy(true); setErr("");
    try {
      onSaved(await api.editMembership(membership.id, { tier, attributes: values }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function saveCustom() {
    if (!cLabel.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr("");
    try {
      const value =
        cKind === "percentDiscount"
          ? { kind: "percentDiscount" as const, percentOff: Number(cPercent) / 100 }
          : { kind: "perk" as const, perks: cPerks.split(",").map((s) => s.trim()).filter(Boolean) };
      const match: Record<string, string[]> = {};
      if (cDomain.trim()) match.domains = [cDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")];
      match.propertyNames = [cLabel.trim()];
      onSaved(await api.editMembership(membership.id, {
        label: cLabel.trim(),
        benefits: [{ scope: "property", match, value }],
      }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-membership-title"
    >
      <div className="w-full max-w-lg rounded-t-xl2 bg-card p-6 shadow-2xl sm:rounded-xl2">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="edit-membership-title" className="font-display text-2xl text-ink">
            {isCustom ? "Edit custom benefit" : `Edit ${program?.name ?? membership.label}`}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-2xl leading-none text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >×</button>
        </div>

        {!isCustom && program ? (
          <div>
            {program.fields.map((f) => (
              <div key={f.key} className="mb-4">
                <label className="label">{f.label}
                  {f.secret && <span className="ml-2 rounded bg-save-soft px-1.5 py-0.5 text-[11px] font-medium text-save-dark">encrypted</span>}
                </label>
                {f.type === "select" ? (
                  <select className="field" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="field" type={f.type === "secret" ? "password" : "text"}
                    placeholder={f.secret && membership.hasCredential ? "Leave blank to keep existing" : f.placeholder}
                    value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
              </div>
            ))}

            <div className="mb-4 rounded-xl bg-save-soft px-4 py-3" data-testid="benefit-summary-edit">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-save-dark">What you&apos;ll get</p>
              {summary.length ? (
                <ul className="space-y-0.5 text-sm text-ink">
                  {summary.map((s) => <li key={s}>• {s}</li>)}
                </ul>
              ) : <p className="text-sm text-ink-muted">Benefits vary by property.</p>}
            </div>

            {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
              <button className="btn-primary flex-1" data-testid="edit-save" onClick={saveCatalog} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="label">Name</label>
            <input className="field mb-4" data-testid="edit-custom-name" placeholder="Hotel PECR" value={cLabel} onChange={(e) => setCLabel(e.target.value)} />
            <label className="label">Website (optional)</label>
            <input className="field mb-4" placeholder="pecr.cz" value={cDomain} onChange={(e) => setCDomain(e.target.value)} />
            <label className="label">Benefit</label>
            <div className="mb-4 flex gap-2">
              <select className="field" value={cKind} onChange={(e) => setCKind(e.target.value as "percentDiscount" | "perk")} style={{ maxWidth: 200 }}>
                <option value="percentDiscount">% discount</option>
                <option value="perk">Perk(s)</option>
              </select>
              {cKind === "percentDiscount" ? (
                <input className="field" type="number" min={0} max={100} value={cPercent} onChange={(e) => setCPercent(e.target.value)} />
              ) : (
                <input className="field" placeholder="Free breakfast, late checkout" value={cPerks} onChange={(e) => setCPerks(e.target.value)} />
              )}
            </div>
            {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
              <button className="btn-primary flex-1" data-testid="edit-save" onClick={saveCustom} disabled={busy || !cLabel.trim()}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
