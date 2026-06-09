"use client";

import { useEffect, useState } from "react";
import { demoApi, type DemoHotelResult, type PlatformStats } from "@/lib/api";

// "CustomRates for your hotel" — the demo a prospective hotel client sees: type a
// hotel, see exactly what a CustomRates end-user is told (book direct + perks +
// perk-value estimates). No prices — perk values are estimates, not room rates.

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-[96px] text-center">
      <div className="font-display text-3xl font-semibold leading-none text-sunset">{value}</div>
      <div className="mt-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}

/** ISO 3166-1 alpha-2 → regional-indicator flag emoji (e.g. "CZ" → 🇨🇿). */
function flag(cc?: string): string {
  if (!cc || !/^[a-z]{2}$/i.test(cc)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => base + ch.charCodeAt(0) - 65));
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function HotelDemo() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<DemoHotelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    demoApi.stats().then(setStats).catch(() => {});
  }, []);

  // Search-as-you-type: debounce keystrokes, fire at >= 2 chars, clear below.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setResult(await demoApi.hotel(query));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lookup failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const inDirectory = (result?.directBooking.length ?? 0) > 0;
  const programs = result?.memberPrograms ?? [];
  const count = (result?.directBooking.length ?? 0) + programs.length;
  const settled = q.trim().length >= 2 && !loading && result !== null;

  return (
    <section data-testid="hotel-demo" className="mx-auto max-w-2xl">
      {stats && (
        <div
          data-testid="platform-stats"
          className="mb-6 flex flex-wrap justify-center gap-x-8 gap-y-4 rounded-xl2 border border-line bg-card px-6 py-5 shadow-soft"
        >
          <Stat value={stats.hotelsCovered.toLocaleString()} label="hotels covered" />
          <Stat value={String(stats.countries)} label="countries" />
          <Stat value={String(stats.programs)} label="loyalty programs" />
          <Stat value={stats.benefitSurfaces.toLocaleString()} label="benefit views" />
        </div>
      )}

      <input
        data-testid="hotel-demo-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Start typing your hotel — e.g. Olympia, Marriott Prague, your own property"
        autoComplete="off"
        aria-label="Hotel name"
        className="field text-lg shadow-soft"
      />
      <div data-testid="hotel-demo-status" className="mb-1 mt-2 min-h-[18px] px-1 text-sm text-ink-muted">
        {q.trim().length === 1 ? "Keep typing…" : loading ? "Searching…" : settled ? `${count} result${count === 1 ? "" : "s"}` : ""}
      </div>

      {error && <p role="alert" className="text-sun-deep">{error}</p>}

      {result && (
        <div data-testid="hotel-demo-result" className="mt-3 space-y-4">
          <p className="text-sm text-ink-muted">
            This is exactly what a traveler&apos;s AI assistant or CustomRates browser extension tells them about <strong className="text-ink">{result.query}</strong>:
          </p>

          {inDirectory && (
            <div data-testid="demo-direct" className="rounded-xl2 border border-sea/20 bg-sea-soft/60 p-5">
              <div className="font-semibold text-sea-deep">✓ Book direct — skip the OTA commission</div>
              <ul className="mt-2 space-y-2.5">
                {result.directBooking.map((h) => (
                  <li key={h.realizationUrl} className="text-sm">
                    <span className="font-semibold text-ink">{h.name}</span>{" "}
                    <span className="text-ink-muted">
                      {flag(h.country)} {[h.city, h.country].filter(Boolean).join(", ")}
                    </span>
                    <br />
                    <a href={h.realizationUrl} target="_blank" rel="noreferrer" className="text-sea hover:underline">
                      {host(h.realizationUrl)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {programs.length > 0 && (
            <div data-testid="demo-perks" className="rounded-xl2 border border-line bg-card p-5 shadow-soft">
              <div className="mb-2 font-semibold text-ink">Loyalty perks a member sees here</div>
              <div className="space-y-4">
                {programs.map((p) => (
                  <div key={p.programId}>
                    <div className="font-semibold text-ink">
                      {p.name}{p.topTier ? <span className="text-ink-muted"> · {p.topTier}</span> : null}
                    </div>
                    {p.realizationUrl && (
                      <div className={`my-1 text-sm text-sun-deep ${p.openToAnyone ? "font-semibold" : ""}`}>
                        {p.openToAnyone
                          ? (p.percentOff ?? 0) > 0
                            ? `✓ −${Math.round((p.percentOff ?? 0) * 100)}% for you — just register & book direct at `
                            : "✓ Free to join — register & book direct at "
                          : "✓ members book direct at "}
                        <a href={p.realizationUrl} target="_blank" rel="noreferrer" className="underline">
                          {host(p.realizationUrl)}
                        </a>
                      </div>
                    )}
                    <ul className="ml-4 list-disc text-sm text-ink-soft">
                      {p.summary.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                    {p.perkValues.length > 0 && (
                      <div className="mt-1 text-sm text-ink-muted">
                        est. perk value:{" "}
                        {p.perkValues.map((v, i) => (
                          <span key={i}>{i > 0 ? " · " : ""}{v.label} ≈ ${v.estUsd}</span>
                        ))}
                        <span className="italic"> (estimate, not a price)</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {settled && !inDirectory && programs.length === 0 && (
            <div data-testid="demo-empty" className="rounded-xl2 border border-dashed border-line bg-paper p-5 text-ink-muted">
              We don&apos;t have <strong className="text-ink">{result.query}</strong> yet — that&apos;s exactly the gap CustomRates fills. Add your direct-booking offer and travelers start seeing it.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
