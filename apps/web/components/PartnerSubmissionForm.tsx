"use client";

import { useState } from "react";
import { partnerApi, type PartnerOrg, type PartnerProgramDraft, type ProgramCategory } from "@/lib/api";

const CATEGORIES: ProgramCategory[] = ["hotel", "airline", "rail", "carRental", "ota", "card", "subscription"];
const REGIONS = ["CZ", "SK", "PL", "HU", "DE", "AT", "Global"];

const EMPTY_DRAFT: PartnerProgramDraft = {
  name: "",
  category: "hotel",
  region: "CZ",
  sourceUrl: "",
  tiers: [],
  fields: [],
  benefits: {},
};

interface Props {
  orgs: PartnerOrg[];
  initialOrgId?: string;
  initialDraft?: PartnerProgramDraft;
  submissionId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function PartnerSubmissionForm({ orgs, initialOrgId, initialDraft, submissionId, onSaved, onCancel }: Props) {
  const [orgId, setOrgId] = useState(initialOrgId ?? orgs[0]?.id ?? "");
  const [draft, setDraft] = useState<PartnerProgramDraft>(initialDraft ?? EMPTY_DRAFT);
  const [tiersInput, setTiersInput] = useState((initialDraft?.tiers ?? []).join(", "));
  const [benefitsJson, setBenefitsJson] = useState(() => JSON.stringify(initialDraft?.benefits ?? {}, null, 2));
  const [benefitsError, setBenefitsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeOrgs = orgs.filter((o) => o.status === "active");
  const pendingOrgs = orgs.filter((o) => o.status === "pending");

  function set<K extends keyof PartnerProgramDraft>(key: K, value: PartnerProgramDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function parseBenefits(): Record<string, unknown[]> | null {
    try {
      const parsed = JSON.parse(benefitsJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setBenefitsError("Benefits must be a JSON object keyed by tier (or \"*\" for all tiers)");
        return null;
      }
      setBenefitsError(null);
      return parsed as Record<string, unknown[]>;
    } catch {
      setBenefitsError("Invalid JSON");
      return null;
    }
  }

  async function handleSave(andSubmit = false) {
    setError(null);
    const benefits = parseBenefits();
    if (!benefits) return;

    const tiers = tiersInput.split(",").map((t: string) => t.trim()).filter(Boolean);
    const fullDraft: PartnerProgramDraft = { ...draft, tiers: tiers.length ? tiers : undefined, benefits: benefits as PartnerProgramDraft["benefits"] };

    setSaving(true);
    try {
      let submission;
      if (submissionId) {
        ({ submission } = await partnerApi.updateSubmission(submissionId, fullDraft));
      } else {
        ({ submission } = await partnerApi.createSubmission({ ...fullDraft, orgId }));
      }
      if (andSubmit) {
        await partnerApi.submitForReview(submission.id);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = activeOrgs.some((o) => o.id === orgId) || (!submissionId && activeOrgs.length > 0);

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!submissionId && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="partner-org">
            Organization
          </label>
          {activeOrgs.length === 0 && pendingOrgs.length === 0 ? (
            <p className="text-sm text-ink-muted">No active organizations. Create one first.</p>
          ) : (
            <select
              id="partner-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {activeOrgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name} (active)</option>
              ))}
              {pendingOrgs.map((o) => (
                <option key={o.id} value={o.id} disabled>{o.name} (pending approval)</option>
              ))}
            </select>
          )}
          {activeOrgs.length === 0 && pendingOrgs.length > 0 && (
            <p className="text-xs text-amber-600">Your organization is pending admin approval. You can draft submissions now but cannot submit until approved.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="draft-name">
            Program name <span className="text-red-500">*</span>
          </label>
          <input
            id="draft-name"
            type="text"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Marriott Bonvoy"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="draft-category">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            id="draft-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value as ProgramCategory)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="draft-region">
            Region <span className="text-red-500">*</span>
          </label>
          <select
            id="draft-region"
            value={draft.region}
            onChange={(e) => set("region", e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="draft-source-url">
            Source URL
          </label>
          <input
            id="draft-source-url"
            type="url"
            value={draft.sourceUrl ?? ""}
            onChange={(e) => set("sourceUrl", e.target.value || undefined)}
            placeholder="https://..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor="draft-tiers">
          Tiers <span className="text-xs font-normal text-ink-muted">(comma-separated, leave blank for a single-tier program)</span>
        </label>
        <input
          id="draft-tiers"
          type="text"
          value={tiersInput}
          onChange={(e) => setTiersInput(e.target.value)}
          placeholder="e.g. Silver, Gold, Platinum"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor="draft-benefits">
          Benefits (JSON) <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-ink-muted">
          Keys are tier names (or <code className="rounded bg-surface-raised px-1">*</code> for all tiers). Values are arrays of benefit objects with{" "}
          <code className="rounded bg-surface-raised px-1">scope</code>, optional{" "}
          <code className="rounded bg-surface-raised px-1">match</code>, and{" "}
          <code className="rounded bg-surface-raised px-1">value</code> (kind:{" "}
          <code className="rounded bg-surface-raised px-1">percentDiscount</code>,{" "}
          <code className="rounded bg-surface-raised px-1">perk</code>, or{" "}
          <code className="rounded bg-surface-raised px-1">pointsEarn</code> — no prices).
        </p>
        <textarea
          id="draft-benefits"
          rows={10}
          value={benefitsJson}
          onChange={(e) => setBenefitsJson(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent"
          spellCheck={false}
        />
        {benefitsError && (
          <p role="alert" className="text-xs text-red-600">{benefitsError}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving || !draft.name}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        {canSubmit && (
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving || !draft.name}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Save & submit for review"}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
