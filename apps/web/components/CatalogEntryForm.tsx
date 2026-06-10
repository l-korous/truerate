"use client";

import { useState, useEffect } from "react";
import type { CatalogEntry, CatalogEntryInput } from "@/lib/api";

interface Props {
  initial?: CatalogEntry;
  onSave: (input: CatalogEntryInput) => void;
  saving: boolean;
}

const CATEGORIES = ["hotel", "airline", "rail", "carRental", "ota", "card", "subscription"] as const;
const PROVENANCE_SOURCES = ["manual-seed", "scrape-proposal", "partner-submission"] as const;

function emptyInput(): CatalogEntryInput {
  const now = new Date().toISOString().slice(0, 7);
  return {
    programId: "",
    name: "",
    category: "hotel",
    region: "Global",
    requiresCredential: false,
    provenance: { source: "manual-seed", asOf: now },
    defaultMatch: {},
    tiers: [],
    fields: [],
    benefits: {},
    realizationUrl: "",
    openToAnyone: false,
  };
}

function entryToInput(entry: CatalogEntry): CatalogEntryInput {
  return {
    programId: entry.programId,
    name: entry.name,
    category: entry.category,
    region: entry.region,
    requiresCredential: entry.requiresCredential,
    provenance: entry.provenance,
    defaultMatch: entry.defaultMatch,
    tiers: entry.tiers,
    fields: entry.fields,
    benefits: entry.benefits,
    realizationUrl: entry.realizationUrl,
    openToAnyone: entry.openToAnyone,
  };
}

export function CatalogEntryForm({ initial, onSave, saving }: Props) {
  const [form, setForm] = useState<CatalogEntryInput>(initial ? entryToInput(initial) : emptyInput());
  const [benefitsJson, setBenefitsJson] = useState(() => JSON.stringify(initial?.benefits ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [defaultMatchJson, setDefaultMatchJson] = useState(() =>
    JSON.stringify(initial?.defaultMatch ?? {}, null, 2),
  );
  const [matchError, setMatchError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm(entryToInput(initial));
      setBenefitsJson(JSON.stringify(initial.benefits, null, 2));
      setDefaultMatchJson(JSON.stringify(initial.defaultMatch, null, 2));
    }
  }, [initial]);

  const set = <K extends keyof CatalogEntryInput>(key: K, value: CatalogEntryInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setProvenance = <K extends keyof CatalogEntryInput["provenance"]>(
    key: K,
    value: CatalogEntryInput["provenance"][K],
  ) => setForm((prev) => ({ ...prev, provenance: { ...prev.provenance, [key]: value } }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let benefits: CatalogEntryInput["benefits"];
    let defaultMatch: CatalogEntryInput["defaultMatch"];

    try {
      benefits = JSON.parse(benefitsJson);
    } catch {
      setJsonError("Benefits JSON is invalid");
      return;
    }
    try {
      defaultMatch = JSON.parse(defaultMatchJson);
    } catch {
      setMatchError("Default match JSON is invalid");
      return;
    }
    setJsonError(null);
    setMatchError(null);
    onSave({ ...form, benefits, defaultMatch });
  };

  const tiersValue = (form.tiers ?? []).join(", ");

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="catalog-entry-form">
      <section className="rounded-xl border border-line bg-card p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Identity</h2>

        <label className="block">
          <span className="text-sm text-ink-muted">Program ID *</span>
          <input
            required
            value={form.programId}
            onChange={(e) => set("programId", e.target.value)}
            placeholder="booking_genius"
            disabled={!!initial}
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink disabled:opacity-60"
            data-testid="field-programId"
          />
        </label>

        <label className="block">
          <span className="text-sm text-ink-muted">Name *</span>
          <input
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Booking.com Genius"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            data-testid="field-name"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-ink-muted">Category *</span>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              data-testid="field-category"
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-ink-muted">Region *</span>
            <input
              required
              value={form.region}
              onChange={(e) => set("region", e.target.value)}
              placeholder="CZ or Global"
              className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              data-testid="field-region"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm text-ink-muted">Tiers (comma-separated)</span>
          <input
            value={tiersValue}
            onChange={(e) =>
              set("tiers", e.target.value ? e.target.value.split(",").map((t) => t.trim()).filter(Boolean) : [])
            }
            placeholder="Level 1, Level 2, Level 3"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            data-testid="field-tiers"
          />
        </label>

        <label className="block">
          <span className="text-sm text-ink-muted">Realization URL — direct-booking URL where the discount is obtained</span>
          <input
            value={form.realizationUrl ?? ""}
            onChange={(e) => set("realizationUrl", e.target.value || undefined)}
            placeholder="https://..."
            type="url"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            data-testid="field-realizationUrl"
          />
        </label>

        <div className="flex gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.requiresCredential}
              onChange={(e) => set("requiresCredential", e.target.checked)}
              className="rounded"
              data-testid="field-requiresCredential"
            />
            <span className="text-sm text-ink-muted">Requires credential (membership number / login)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.openToAnyone ?? false}
              onChange={(e) => set("openToAnyone", e.target.checked)}
              className="rounded"
              data-testid="field-openToAnyone"
            />
            <span className="text-sm text-ink-muted">Open to anyone (free registration, no status required)</span>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-card p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Provenance</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-ink-muted">Source *</span>
            <select
              value={form.provenance.source}
              onChange={(e) => setProvenance("source", e.target.value as typeof PROVENANCE_SOURCES[number])}
              className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              data-testid="field-provenance-source"
            >
              {PROVENANCE_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-ink-muted">As of (YYYY-MM) *</span>
            <input
              required
              value={form.provenance.asOf}
              onChange={(e) => setProvenance("asOf", e.target.value)}
              placeholder="2026-05"
              pattern="\d{4}-\d{2}"
              className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              data-testid="field-provenance-asOf"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm text-ink-muted">Source URL</span>
          <input
            value={form.provenance.sourceUrl ?? ""}
            onChange={(e) => setProvenance("sourceUrl", e.target.value || undefined)}
            placeholder="https://..."
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            data-testid="field-provenance-sourceUrl"
          />
        </label>

        <label className="block">
          <span className="text-sm text-ink-muted">Notes</span>
          <textarea
            value={form.provenance.notes ?? ""}
            onChange={(e) => setProvenance("notes", e.target.value || undefined)}
            rows={2}
            placeholder="Summary of changes in this version…"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            data-testid="field-provenance-notes"
          />
        </label>
      </section>

      <section className="rounded-xl border border-line bg-card p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Default match (JSON)</h2>
        <p className="text-xs text-ink-muted">
          Matching rules inherited by all benefits. E.g. <code>{`{"domains":["booking.com"]}`}</code>
        </p>
        <textarea
          value={defaultMatchJson}
          onChange={(e) => {
            setDefaultMatchJson(e.target.value);
            setMatchError(null);
          }}
          rows={4}
          spellCheck={false}
          className={`mt-1 block w-full rounded-lg border px-3 py-2 font-mono text-xs text-ink ${matchError ? "border-red-400" : "border-line"} bg-paper`}
          data-testid="field-defaultMatch"
        />
        {matchError && <p className="text-xs text-red-600">{matchError}</p>}
      </section>

      <section className="rounded-xl border border-line bg-card p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Benefits (JSON)</h2>
        <p className="text-xs text-ink-muted">
          Keyed by tier name (or <code>"*"</code> for all tiers). No prices — only{" "}
          <code>percentDiscount</code>, <code>perk</code>, <code>pointsEarn</code>.
        </p>
        <textarea
          value={benefitsJson}
          onChange={(e) => {
            setBenefitsJson(e.target.value);
            setJsonError(null);
          }}
          rows={12}
          spellCheck={false}
          className={`mt-1 block w-full rounded-lg border px-3 py-2 font-mono text-xs text-ink ${jsonError ? "border-red-400" : "border-line"} bg-paper`}
          data-testid="field-benefits"
        />
        {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-ink px-6 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          data-testid="save-button"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
      </div>
    </form>
  );
}
