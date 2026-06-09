"use client";

import { useEffect, useState } from "react";
import { demoApi, type DemoHotelResult, type PlatformStats } from "@/lib/api";

// "TrueRate for your hotel" — the demo a prospective hotel client sees: type a
// hotel, see exactly what a TrueRate end-user is told (book direct + perks +
// perk-value estimates). No prices — perk values are estimates, not room rates.

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: "center", minWidth: 110 }}>
      <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#1d3a8a", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#667", marginTop: 4 }}>{label}</div>
    </div>
  );
}

/** ISO 3166-1 alpha-2 → regional-indicator flag emoji (e.g. "CZ" → 🇨🇿). */
function flag(cc?: string): string {
  if (!cc || !/^[a-z]{2}$/i.test(cc)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => base + ch.charCodeAt(0) - 65));
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
    <section data-testid="hotel-demo" style={{ maxWidth: 720, margin: "0 auto" }}>
      {stats && (
        <div data-testid="platform-stats" style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap", padding: "1.25rem", background: "#f4f6fc", borderRadius: 12, marginBottom: "1.5rem" }}>
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
        placeholder="Start typing your hotel name — e.g. Olympia, Marriott Prague, your own property"
        autoComplete="off"
        aria-label="Hotel name"
        style={{ width: "100%", boxSizing: "border-box", padding: "0.7rem 0.9rem", fontSize: "1rem", border: "1px solid #ccd", borderRadius: 8 }}
      />
      <div data-testid="hotel-demo-status" style={{ minHeight: 18, fontSize: "0.8rem", color: "#889", margin: "4px 2px 0" }}>
        {q.trim().length === 1 ? "Keep typing…" : loading ? "Searching…" : settled ? `${count} result${count === 1 ? "" : "s"}` : ""}
      </div>

      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}

      {result && (
        <div data-testid="hotel-demo-result" style={{ marginTop: "0.75rem" }}>
          <p style={{ color: "#667", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
            This is exactly what a traveler&apos;s AI assistant or TrueRate browser extension tells them about <strong>{result.query}</strong>:
          </p>

          {inDirectory && (
            <div data-testid="demo-direct" style={{ border: "1px solid #d6e6d6", background: "#f3faf3", borderRadius: 10, padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ fontWeight: 700, color: "#1a7f37" }}>✓ Book direct — skip the OTA commission</div>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {result.directBooking.map((h) => (
                  <li key={h.realizationUrl} style={{ marginBottom: 6 }}>
                    <strong>{h.name}</strong>{" "}
                    <span style={{ color: "#667", fontSize: "0.9rem" }}>
                      {flag(h.country)} {[h.city, h.country].filter(Boolean).join(", ")}
                    </span>
                    <br />
                    <a href={h.realizationUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.9rem" }}>
                      {h.realizationUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {programs.length > 0 && (
            <div data-testid="demo-perks" style={{ border: "1px solid #dde", borderRadius: 10, padding: "1rem" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Loyalty perks a member sees here</div>
              {programs.map((p) => (
                <div key={p.programId} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ fontWeight: 600 }}>{p.name}{p.topTier ? ` · ${p.topTier}` : ""}</div>
                  {p.realizationUrl && (
                    <div style={{ fontSize: "0.85rem", color: "#1a7f37", margin: "3px 0", fontWeight: p.openToAnyone ? 700 : 400 }}>
                      {p.openToAnyone
                        ? (p.percentOff ?? 0) > 0
                          ? `✓ −${Math.round((p.percentOff ?? 0) * 100)}% for you — just register & book direct at `
                          : "✓ Free to join — register & book direct at "
                        : "✓ members book direct at "}
                      <a href={p.realizationUrl} target="_blank" rel="noreferrer">
                        {p.realizationUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    </div>
                  )}
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem", color: "#445" }}>
                    {p.summary.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                  {p.perkValues.length > 0 && (
                    <div style={{ fontSize: "0.85rem", color: "#667", marginTop: 4 }}>
                      est. perk value:{" "}
                      {p.perkValues.map((v, i) => (
                        <span key={i}>{i > 0 ? " · " : ""}{v.label} ≈ ${v.estUsd}</span>
                      ))}
                      <span style={{ fontStyle: "italic" }}> (estimate, not a price)</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {settled && !inDirectory && programs.length === 0 && (
            <div data-testid="demo-empty" style={{ color: "#667" }}>
              We don&apos;t have <strong>{result.query}</strong> yet — that&apos;s exactly the gap TrueRate fills. Add your direct-booking offer and travelers start seeing it.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
