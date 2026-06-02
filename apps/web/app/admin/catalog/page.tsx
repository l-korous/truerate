"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  region?: string;
  asOf?: string;
  sourceUrl?: string;
  confidence: {
    level: "high" | "medium" | "low" | "stale";
    score: number;
    ageMonths: number;
    expiresAt: string;
    isExpired: boolean;
  };
}

const LEVEL_STYLES: Record<string, string> = {
  high: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  low: "bg-orange-50 text-orange-700 border-orange-200",
  stale: "bg-red-50 text-red-700 border-red-200",
};

function Badge({ level }: { level: string }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLES[level] ?? ""}`}>
      {level}
    </span>
  );
}

export default function AdminCatalogPage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API}/admin/catalog/confidence`)
      .then((r) => r.json())
      .then((data: { catalog: CatalogEntry[]; generatedAt: string }) => {
        setEntries(data.catalog);
        setGeneratedAt(data.generatedAt);
      })
      .catch(() => setError(true));
  }, []);

  const staleCount = entries.filter((e) => e.confidence.level === "stale" || e.confidence.isExpired).length;
  const lowCount = entries.filter((e) => e.confidence.level === "low").length;

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-save" />
          <h1 className="font-display text-3xl text-ink">Catalog confidence</h1>
        </div>

        {error && <p className="text-sm text-red-600">Failed to load catalog data.</p>}

        {!entries.length && !error && <p className="text-sm text-ink-muted">Loading…</p>}

        {entries.length > 0 && (
          <>
            <div className="mb-6 flex gap-4">
              <div className="rounded-xl border border-line bg-card px-4 py-3" data-testid="stale-count">
                <p className="text-xs text-ink-muted">Stale / expired</p>
                <p className="mt-1 font-display text-2xl text-red-600">{staleCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-card px-4 py-3" data-testid="low-count">
                <p className="text-xs text-ink-muted">Low confidence</p>
                <p className="mt-1 font-display text-2xl text-orange-600">{lowCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-card px-4 py-3">
                <p className="text-xs text-ink-muted">Total entries</p>
                <p className="mt-1 font-display text-2xl text-ink">{entries.length}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line bg-card" data-testid="catalog-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                    <th className="px-4 py-3">Program</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Region</th>
                    <th className="px-4 py-3">As of</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-grain" data-testid={`catalog-row-${e.id}`}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-ink">{e.name}</span>
                        {e.sourceUrl && (
                          <a
                            href={e.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-ink-muted underline"
                          >
                            source
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{e.category}</td>
                      <td className="px-4 py-3 text-ink-muted">{e.region ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{e.asOf ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge level={e.confidence.level} />
                        {e.confidence.isExpired && (
                          <span className="ml-1 text-xs text-red-600">expired</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink-muted">
                        {Math.round(e.confidence.score * 100)}%
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{e.confidence.expiresAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {generatedAt && (
              <p className="mt-4 text-xs text-ink-muted">
                Generated at {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
