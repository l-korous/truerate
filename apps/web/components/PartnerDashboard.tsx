"use client";

import { useEffect, useState } from "react";
import { partnerApi, type PartnerOrg, type PartnerSubmission, type OrgSubscription } from "@/lib/api";
import { PartnerSubmissionForm } from "./PartnerSubmissionForm";

type View = "dashboard" | "new-org" | "new-submission" | { edit: string };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-surface-raised text-ink-muted",
  submitted: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

interface NewOrgFormProps {
  onCreated: (org: PartnerOrg) => void;
  onCancel: () => void;
}

function NewOrgForm({ onCreated, onCancel }: NewOrgFormProps) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("CZ");
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { org } = await partnerApi.createOrg({ name, country, contactEmail });
      onCreated(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Register your organization</h2>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className="block text-sm font-medium text-ink" htmlFor="org-name">
            Organization name <span className="text-red-500">*</span>
          </label>
          <input
            id="org-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marriott International"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="org-country">
            Country <span className="text-red-500">*</span>
          </label>
          <select
            id="org-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {["CZ", "SK", "PL", "HU", "DE", "AT", "US", "GB"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="org-email">
            Contact email <span className="text-red-500">*</span>
          </label>
          <input
            id="org-email"
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="partner@yourcompany.com"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving || !name || !contactEmail}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Registering…" : "Register organization"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TrialBanner({ sub }: { sub: OrgSubscription }) {
  if (sub.status === "none") return null;
  if (sub.status === "active") {
    return (
      <p className="mt-1.5 text-xs text-green-600">Subscription active</p>
    );
  }
  if (sub.status === "canceled" || (sub.status === "trialing" && sub.daysLeft === 0)) {
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        <span className="font-semibold">Trial expired.</span> Start a subscription to continue listing your program on TrueRate.
      </div>
    );
  }
  if (sub.status === "past_due") {
    return (
      <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
        <span className="font-semibold">Payment past due.</span> Please update your billing details to keep your program active.
      </div>
    );
  }
  if (sub.status === "trialing" && sub.daysLeft !== null) {
    const urgent = sub.daysLeft <= 7;
    const colorClass = urgent
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-blue-100 bg-blue-50 text-blue-700";
    return (
      <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${colorClass}`}>
        <span className="font-semibold">
          {sub.daysLeft === 1 ? "Trial expires tomorrow." : `${sub.daysLeft} days left in your free trial.`}
        </span>{" "}
        {urgent ? "Add a payment method now to avoid interruption." : "Upgrade at any time from your billing settings."}
      </div>
    );
  }
  return null;
}

export function PartnerDashboard() {
  const [orgs, setOrgs] = useState<PartnerOrg[]>([]);
  const [submissions, setSubmissions] = useState<PartnerSubmission[]>([]);
  const [subscriptions, setSubscriptions] = useState<Record<string, OrgSubscription>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [editingSubmission, setEditingSubmission] = useState<PartnerSubmission | null>(null);

  async function load() {
    setError(null);
    try {
      const [orgRes, subRes] = await Promise.all([partnerApi.myOrgs(), partnerApi.listSubmissions()]);
      setOrgs(orgRes.orgs);
      setSubmissions(subRes.submissions);

      // Fetch subscription status for each org (best-effort — silently skip on error).
      const subsByOrg: Record<string, OrgSubscription> = {};
      await Promise.all(
        orgRes.orgs.map(async (org) => {
          try {
            const s = await partnerApi.getOrgSubscription(org.id);
            subsByOrg[org.id] = s;
          } catch {
            // Subscription info unavailable — non-fatal.
          }
        }),
      );
      setSubscriptions(subsByOrg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load partner data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmitForReview(id: string) {
    try {
      await partnerApi.submitForReview(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    }
  }

  async function loadEditSubmission(id: string) {
    try {
      const { submission } = await partnerApi.getSubmission(id);
      setEditingSubmission(submission);
      setView({ edit: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submission");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm text-ink-muted">Loading partner portal…</span>
      </div>
    );
  }

  if (view === "new-org") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <NewOrgForm
          onCreated={(org) => { setOrgs((prev) => [...prev, org]); setView("dashboard"); }}
          onCancel={() => setView("dashboard")}
        />
      </div>
    );
  }

  if (view === "new-submission") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h2 className="mb-6 text-lg font-semibold text-ink">New program submission</h2>
        <PartnerSubmissionForm
          orgs={orgs}
          onSaved={() => { load(); setView("dashboard"); }}
          onCancel={() => setView("dashboard")}
        />
      </div>
    );
  }

  if (typeof view === "object" && "edit" in view && editingSubmission) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h2 className="mb-6 text-lg font-semibold text-ink">Edit submission</h2>
        <PartnerSubmissionForm
          orgs={orgs}
          initialOrgId={editingSubmission.orgId}
          initialDraft={editingSubmission.programDraft}
          submissionId={editingSubmission.id}
          onSaved={() => { load(); setView("dashboard"); setEditingSubmission(null); }}
          onCancel={() => { setView("dashboard"); setEditingSubmission(null); }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-semibold text-ink">Partner portal</h1>
        <div className="flex gap-2">
          {orgs.length === 0 && (
            <button
              onClick={() => setView("new-org")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Register organization
            </button>
          )}
          {orgs.some((o) => o.status === "active") && (
            <button
              onClick={() => setView("new-submission")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              New submission
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Organizations */}
      {orgs.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Your organizations</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {orgs.map((org) => {
              const sub = subscriptions[org.id];
              return (
                <div key={org.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-ink">{org.name}</p>
                      <p className="text-xs text-ink-muted">{org.country} · {org.contactEmail}</p>
                      {org.status === "rejected" && org.rejectReason && (
                        <p className="mt-1 text-xs text-red-600">Rejected: {org.rejectReason}</p>
                      )}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[org.status] ?? ""}`}>
                      {org.status}
                    </span>
                  </div>
                  {sub && <TrialBanner sub={sub} />}
                </div>
              );
            })}
          </div>
          {orgs.every((o) => o.status === "pending") && (
            <p className="mt-2 text-xs text-amber-600">
              Your organization is awaiting admin approval. You can prepare draft submissions in the meantime.
            </p>
          )}
        </section>
      )}

      {/* No org yet */}
      {orgs.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="mb-1 font-medium text-ink">No organization yet</p>
          <p className="mb-4 text-sm text-ink-muted">Register your organization to start submitting program terms and perks.</p>
          <button
            onClick={() => setView("new-org")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Register organization
          </button>
        </div>
      )}

      {/* Submissions */}
      {(orgs.length > 0) && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Program submissions</h2>
            {orgs.some((o) => o.status === "active") && (
              <button
                onClick={() => setView("new-submission")}
                className="text-sm font-medium text-accent hover:underline"
              >
                + New submission
              </button>
            )}
          </div>

          {submissions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
              <p className="text-sm text-ink-muted">No submissions yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-surface">
              {submissions.map((sub) => (
                <div key={sub.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{sub.programDraft.name}</p>
                    <p className="text-xs text-ink-muted">
                      {sub.programDraft.category} · {sub.programDraft.region} · updated {new Date(sub.updatedAt).toLocaleDateString()}
                    </p>
                    {sub.status === "rejected" && sub.rejectReason && (
                      <p className="mt-1 text-xs text-red-600">Rejected: {sub.rejectReason}</p>
                    )}
                    {sub.status === "approved" && sub.publishedProgramId && (
                      <p className="mt-1 text-xs text-green-600">Published as: {sub.publishedProgramId}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[sub.status] ?? ""}`}>
                      {STATUS_LABELS[sub.status] ?? sub.status}
                    </span>
                    {sub.status === "draft" && (
                      <>
                        <button
                          onClick={() => loadEditSubmission(sub.id)}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          Edit
                        </button>
                        {orgs.find((o) => o.id === sub.orgId)?.status === "active" && (
                          <button
                            onClick={() => handleSubmitForReview(sub.id)}
                            className="text-xs font-medium text-accent hover:underline"
                          >
                            Submit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
