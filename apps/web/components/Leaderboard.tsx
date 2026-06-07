"use client";

import { useEffect, useState } from "react";
import { adminUsageApi, type UsageAggregation } from "@/lib/api";

// Leaderboard of most-used providers (clients) by surfaced usage (#334).
// Data source: the usage-analytics aggregation (#333). Top 10 globally or per
// country. Shows counts only — NEVER prices (product rule #1).

const COUNTRIES: { code: string; label: string }[] = [
  { code: "", label: "🌍 Global" },
  { code: "CZ", label: "Czechia" },
  { code: "DE", label: "Germany" },
  { code: "PL", label: "Poland" },
  { code: "AT", label: "Austria" },
  { code: "SK", label: "Slovakia" },
  { code: "HU", label: "Hungary" },
];

function prettyProvider(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function Leaderboard() {
  const [country, setCountry] = useState("");
  const [data, setData] = useState<UsageAggregation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminUsageApi
      .get(country ? { country } : {})
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [country]);

  const top = (data?.byProvider ?? []).slice(0, 10);
  const max = top[0]?.count ?? 0;

  return (
    <section data-testid="leaderboard" style={{ maxWidth: 640 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <h2 style={{ margin: 0 }}>Most-used providers</h2>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.9rem" }}>
            How often each provider&apos;s discounts &amp; perks surfaced to users.
          </p>
        </div>
        <label style={{ fontSize: "0.9rem" }}>
          Region{" "}
          <select
            data-testid="leaderboard-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loading && <p data-testid="leaderboard-loading">Loading…</p>}
      {error && (
        <p role="alert" data-testid="leaderboard-error" style={{ color: "#b00020" }}>
          Couldn&apos;t load the leaderboard: {error}
        </p>
      )}
      {!loading && !error && top.length === 0 && (
        <p data-testid="leaderboard-empty" style={{ color: "#666" }}>
          No usage recorded yet for this selection.
        </p>
      )}
      {!loading && !error && top.length > 0 && (
        <ol data-testid="leaderboard-list" style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
          {top.map((b, i) => (
            <li
              key={b.key}
              data-testid="leaderboard-row"
              style={{ display: "grid", gridTemplateColumns: "2rem 1fr auto", alignItems: "center", gap: "0.75rem", padding: "0.4rem 0", borderBottom: "1px solid #eee" }}
            >
              <span style={{ fontWeight: 700, color: "#888" }}>#{i + 1}</span>
              <span>
                <span style={{ fontWeight: 600 }}>{prettyProvider(b.key)}</span>
                <span aria-hidden style={{ display: "block", height: 4, marginTop: 4, borderRadius: 2, background: "#e6e6ff", width: max ? `${Math.max(6, Math.round((b.count / max) * 100))}%` : "0%" }} />
              </span>
              <span style={{ color: "#444", fontVariantNumeric: "tabular-nums" }}>
                {b.count.toLocaleString()} surfaced
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
