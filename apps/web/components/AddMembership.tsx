"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Program, type PublicUser } from "@/lib/api";

const CATEGORY_LABEL: Record<string, string> = {
  ota: "Travel agency", hotel: "Hotel group", airline: "Airline",
  subscription: "Subscription", card: "Card", rail: "Rail", carRental: "Car rental",
};

type Mode = "pick" | "catalog" | "custom";

export function AddMembership({
  programs, onAdded, onClose,
}: {
  programs: Program[];
  onAdded: (u: PublicUser) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("pick");
  const [program, setProgram] = useState<Program | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // custom-benefit state
  const [cLabel, setCLabel] = useState("");
  const [cDomain, setCDomain] = useState("");
  const [cKind, setCKind] = useState<"percentDiscount" | "perk">("percentDiscount");
  const [cPercent, setCPercent] = useState("15");
  const [cPerks, setCPerks] = useState("");

  useEffect(() => {
    if (!program) return;
    const seed: Record<string, string> = {};
    for (const f of program.fields) if (f.type === "select" && f.options?.length) seed[f.key] = f.options[0]!;
    setValues(seed);
  }, [program]);

  const tier = values["tier"];
  const summary = useMemo(() => {
    if (!program) return [];
    return program.summaryByTier[tier ?? "*"] ?? program.summaryByTier["*"] ?? [];
  }, [program, tier]);

  async function saveCatalog() {
    if (!program) return;
    setBusy(true); setErr("");
    try {
      onAdded(await api.addCatalogMembership({ programId: program.id, tier, attributes: values }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function saveCustom() {
    setBusy(true); setErr("");
    try {
      const value =
        cKind === "percentDiscount"
          ? { kind: "percentDiscount" as const, percentOff: Number(cPercent) / 100 }
          : { kind: "perk" as const, perks: cPerks.split(",").map((s) => s.trim()).filter(Boolean) };
      const match: Record<string, string[]> = {};
      if (cDomain.trim()) match.domains = [cDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")];
      match.propertyNames = [cLabel.trim()];
      onAdded(await api.addCustomMembership({ label: cLabel.trim(), benefits: [{ scope: "property", match, value }] }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-lg rounded-t-xl2 bg-card p-6 shadow-2xl sm:rounded-xl2">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-2xl text-ink">
            {mode === "pick" ? "Add a membership" : mode === "custom" ? "Add a custom benefit" : program?.name}
          </h2>
          <button onClick={onClose} className="text-2xl leading-none text-ink-muted">×</button>
        </div>

        {mode === "pick" && (
          <div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {programs.map((p) => (
                <button key={p.id} data-testid={`program-${p.id}`}
                  onClick={() => { setProgram(p); setMode("catalog"); }}
                  className="flex flex-col items-start rounded-xl border border-line bg-paper px-4 py-3 text-left transition hover:border-ink/30 hover:bg-white">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="mt-0.5 text-xs text-ink-muted">{CATEGORY_LABEL[p.category] ?? p.category}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setMode("custom")} data-testid="add-custom"
              className="mt-3 w-full rounded-xl border border-dashed border-line py-3 text-sm font-medium text-ink-muted hover:bg-white">
              + A specific hotel or deal not listed (e.g. a negotiated rate)
            </button>
          </div>
        )}

        {mode === "catalog" && program && (
          <div>
            {program.fields.map((f) => (
              <div key={f.key} className="mb-4">
                <label className="label">{f.label}
                  {f.secret && <span className="ml-2 rounded bg-save-soft px-1.5 py-0.5 text-[11px] font-medium text-save">encrypted</span>}
                </label>
                {f.type === "select" ? (
                  <select className="field" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="field" type={f.type === "secret" ? "password" : "text"} placeholder={f.placeholder}
                    value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
              </div>
            ))}

            <div className="mb-4 rounded-xl bg-save-soft px-4 py-3" data-testid="benefit-summary">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-save">What you&apos;ll get</p>
              {summary.length ? (
                <ul className="space-y-0.5 text-sm text-ink">
                  {summary.map((s) => <li key={s}>• {s}</li>)}
                </ul>
              ) : <p className="text-sm text-ink-muted">Benefits vary by property.</p>}
            </div>

            {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => { setProgram(null); setMode("pick"); }}>Back</button>
              <button className="btn-primary flex-1" onClick={saveCatalog} disabled={busy}>
                {busy ? "Saving…" : "Add membership"}
              </button>
            </div>
          </div>
        )}

        {mode === "custom" && (
          <div>
            <p className="mb-4 text-sm text-ink-muted">
              Tell TrueRate about a benefit you hold — a negotiated rate at one hotel, a club discount.
              We&apos;ll surface it (and an indicative price) when you&apos;re on that site.
            </p>
            <label className="label">Name</label>
            <input className="field mb-4" placeholder="Hotel PECR" value={cLabel} onChange={(e) => setCLabel(e.target.value)} />
            <label className="label">Website (optional)</label>
            <input className="field mb-4" placeholder="pecr.cz" value={cDomain} onChange={(e) => setCDomain(e.target.value)} />
            <label className="label">Benefit</label>
            <div className="mb-4 flex gap-2">
              <select className="field" value={cKind} onChange={(e) => setCKind(e.target.value as any)} style={{ maxWidth: 200 }}>
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
              <button className="btn-ghost flex-1" onClick={() => setMode("pick")}>Back</button>
              <button className="btn-primary flex-1" onClick={saveCustom} disabled={busy || !cLabel.trim()}>
                {busy ? "Saving…" : "Add benefit"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
