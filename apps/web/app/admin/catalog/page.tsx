"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminCatalogApi, type CatalogEntry } from "@/lib/api";

type StatusFilter = "all" | "draft" | "in-review" | "published" | "archived";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  "in-review": "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-600",
};

export default function CatalogAdminPage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    adminCatalogApi
      .list(filter === "all" ? undefined : filter)
      .then((r) => setEntries(r.entries))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter]);

  const handleArchive = async (programId: string) => {
    if (!confirm(`Archive ${programId}? This removes it from the public catalog.`)) return;
    try {
      await adminCatalogApi.archive(programId);
      setEntries((prev) => prev.filter((e) => e.programId !== programId));
    } catch (e: unknown) {
      alert(`Archive failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-save" />
            <h1 className="font-display text-3xl text-ink">Catalog editor</h1>
          </div>
          <Link
            href="/admin/catalog/new"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
          >
            New program
          </Link>
        </div>

        <div className="mb-6 flex gap-2">
          {(["all", "draft", "in-review", "published", "archived"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === s
                  ? "bg-ink text-paper"
                  : "bg-card text-ink-muted hover:bg-paper border border-line"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-ink-muted">Loading…</p>}

        {!loading && entries.length === 0 && (
          <p className="text-sm text-ink-muted">No entries found.</p>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-2" data-testid="catalog-list">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-5 py-4"
                data-testid={`catalog-entry-${entry.programId}`}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-medium text-ink">{entry.name}</p>
                    <p className="text-xs text-ink-muted">
                      {entry.programId} · {entry.category} · {entry.region} · v{entry.version}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {entry.status}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/admin/catalog/${entry.programId}`}
                    className="text-sm text-ink underline-offset-2 hover:underline"
                  >
                    Edit
                  </Link>
                  {entry.status !== "archived" && (
                    <button
                      onClick={() => handleArchive(entry.programId)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
