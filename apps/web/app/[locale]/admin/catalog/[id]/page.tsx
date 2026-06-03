"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminCatalogApi, type CatalogEntry, type CatalogEntryInput } from "@/lib/api";
import { CatalogEntryForm } from "@/components/CatalogEntryForm";
import { CatalogVersionHistory } from "@/components/CatalogVersionHistory";

type Tab = "edit" | "history";

export default function CatalogEntryPage() {
  const params = useParams<{ locale: string; id: string }>();
  const id = params.id;
  const router = useRouter();
  const isNew = id === "new";

  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [history, setHistory] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("edit");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadEntry = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const [entryRes, histRes] = await Promise.all([
        adminCatalogApi.get(id),
        adminCatalogApi.history(id),
      ]);
      setEntry(entryRes.entry);
      setHistory(histRes.history);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load entry");
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    loadEntry();
  }, [loadEntry]);

  const handleSave = async (input: CatalogEntryInput) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (isNew) {
        const res = await adminCatalogApi.create(input);
        setSuccess("Draft created.");
        router.push(`/admin/catalog/${res.entry.programId}`);
      } else {
        const res = await adminCatalogApi.update(id, input);
        setEntry(res.entry);
        setSuccess("Draft saved.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm("Publish this draft? It will become the live version consumed by channels.")) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await adminCatalogApi.publish(id);
      setEntry(res.entry);
      setSuccess("Published successfully.");
      await loadEntry();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (version: number) => {
    if (!confirm(`Restore version ${version} as a new draft?`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await adminCatalogApi.restore(id, version);
      setEntry(res.entry);
      setSuccess(`Version ${version} restored as draft v${res.entry.version}.`);
      setTab("edit");
      await loadEntry();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-grain">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  const isDraft = entry?.status === "draft" || entry?.status === "in-review";

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => router.push("/admin/catalog")}
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← Catalog
          </button>
          <span className="text-ink-muted">/</span>
          <h1 className="font-display text-2xl text-ink">
            {isNew ? "New program" : (entry?.name ?? id)}
          </h1>
          {entry && (
            <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink-muted border border-line">
              v{entry.version} · {entry.status}
            </span>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="status">
            {success}
          </p>
        )}

        {!isNew && (
          <div className="mb-6 flex gap-1 border-b border-line">
            {(["edit", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t
                    ? "border-b-2 border-ink text-ink -mb-px"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {t === "edit" ? "Edit" : "Version history"}
              </button>
            ))}
          </div>
        )}

        {(isNew || tab === "edit") && (
          <>
            <CatalogEntryForm
              initial={entry ?? undefined}
              onSave={handleSave}
              saving={saving}
            />
            {!isNew && isDraft && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handlePublish}
                  disabled={saving}
                  className="rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                  data-testid="publish-button"
                >
                  {saving ? "Publishing…" : "Publish draft"}
                </button>
              </div>
            )}
          </>
        )}

        {!isNew && tab === "history" && (
          <CatalogVersionHistory
            history={history}
            currentVersion={entry?.version}
            onRestore={handleRestore}
            restoring={saving}
          />
        )}
      </div>
    </div>
  );
}
