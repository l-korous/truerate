"use client";

import { useState } from "react";
import { api, type EnrichmentResult } from "@/lib/api";

function fmt(n: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n)} ${currency}`; }
}
function inDays(n: number) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function pretty(id: string) { return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

export function DemoSearch() {
  const [location, setLocation] = useState("Prague");
  const [checkIn, setCheckIn] = useState(inDays(14));
  const [checkOut, setCheckOut] = useState(inDays(16));
  const [adults, setAdults] = useState(2);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true); setErr("");
    try { setResult(await api.searchHotels({ location, checkIn, checkOut, adults, rooms: 1 })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="rounded-xl2 border border-line bg-card p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="col-span-2"><label className="label">Destination</label>
            <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div><label className="label">Check-in</label>
            <input className="field" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
          <div><label className="label">Check-out</label>
            <input className="field" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
          <div><label className="label">Adults</label>
            <input className="field" type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></div>
        </div>
        <button className="btn-primary mt-5" onClick={run} disabled={busy}>{busy ? "Searching…" : "Reveal my rates"}</button>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </div>

      {result && (
        <div className="mt-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-xl2 bg-ink p-6 text-paper">
            <div>
              <p className="text-sm text-paper/70">Indicative member savings on this search</p>
              <p className="font-display text-4xl">{fmt(result.totalSavings, result.currency)}</p>
            </div>
            <div className="text-right text-sm text-paper/70">
              {result.programsApplied.length ? `Applied: ${result.programsApplied.map(pretty).join(", ")}` : "Perks only — no member discount matched"}
              {result.mode === "mock" && <span className="ml-2 rounded bg-points/20 px-2 py-0.5 text-points">demo data</span>}
            </div>
          </div>

          <div className="space-y-3">
            {result.properties.map((p) => {
              const saving = p.savingsAmount > 0;
              return (
                <div key={p.propertyId} className="flex flex-col gap-3 rounded-xl2 border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-ink">{p.name}{p.brand ? <span className="ml-2 rounded bg-paper px-2 py-0.5 text-xs text-ink-muted">{p.brand}</span> : null}</p>
                    <p className="text-sm text-ink-muted">{p.area} {p.rating ? `· ${p.rating.toFixed(1)}` : ""}</p>
                    {p.perks.length > 0 && <p className="mt-1 text-xs text-points">+ {p.perks.join(" · ")}</p>}
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Anonymous</p>
                      <p className={`text-lg ${saving ? "text-ink-muted line-through" : "text-ink"}`}>{fmt(p.publicOffer.totalAmount, result.currency)}</p>
                    </div>
                    {saving && (
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-save">
                          {p.bestOffer.label}{p.indicative ? " (est.)" : ""}
                        </p>
                        <p className="text-lg font-semibold text-save">{fmt(p.bestOffer.totalAmount, result.currency)}</p>
                        <p className="text-xs text-save">save {fmt(p.savingsAmount, result.currency)} · {p.savingsPercent}%</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-ink-muted">
            Member prices are indicative estimates from your declared benefits, applied to the public rate. Perks are exact.
          </p>
        </div>
      )}
    </div>
  );
}
