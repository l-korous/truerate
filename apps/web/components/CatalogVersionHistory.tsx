"use client";

import type { CatalogEntry } from "@/lib/api";

interface Props {
  history: CatalogEntry[];
  currentVersion?: number;
  onRestore: (version: number) => void;
  restoring: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  "in-review": "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-600",
};

export function CatalogVersionHistory({ history, currentVersion, onRestore, restoring }: Props) {
  if (history.length === 0) {
    return <p className="text-sm text-ink-muted">No version history available.</p>;
  }

  return (
    <div className="space-y-2" data-testid="version-history">
      {history.map((v) => (
        <div
          key={v.id}
          className={`flex items-start justify-between rounded-xl border px-5 py-4 ${
            v.isCurrent ? "border-ink/20 bg-card" : "border-line bg-card/50"
          }`}
          data-testid={`version-${v.version}`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">v{v.version}</span>
              {v.isCurrent && (
                <span className="rounded-full bg-ink px-2 py-0.5 text-xs text-paper">current</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.status]}`}>
                {v.status}
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {v.publishedAt
                ? `Published ${new Date(v.publishedAt).toLocaleDateString()}`
                : v.archivedAt
                  ? `Archived ${new Date(v.archivedAt).toLocaleDateString()}`
                  : `Updated ${new Date(v.updatedAt).toLocaleDateString()}`}
              {v.provenance.notes && ` · ${v.provenance.notes}`}
            </p>
            <p className="text-xs text-ink-muted">
              Source: {v.provenance.source} · as of {v.provenance.asOf}
              {v.provenance.sourceUrl && (
                <> · <a href={v.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">terms</a></>
              )}
            </p>
          </div>

          {v.version !== currentVersion && (
            <button
              onClick={() => onRestore(v.version)}
              disabled={restoring}
              className="text-sm text-ink underline-offset-2 hover:underline disabled:opacity-50"
              data-testid={`restore-v${v.version}`}
            >
              Restore
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
