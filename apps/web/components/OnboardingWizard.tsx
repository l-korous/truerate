"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Program, type PublicUser } from "@/lib/api";
import { t } from "@/lib/i18n";
import { setOnboardingState } from "@/lib/onboarding";

type WizardStep = "memberships" | "done";

const TOTAL_STEPS = 1;

const CATEGORY_KEY: Record<string, string> = {
  ota: "category_ota",
  hotel: "category_hotel",
  airline: "category_airline",
  subscription: "category_subscription",
  card: "category_card",
  rail: "category_rail",
  carRental: "category_carRental",
};

function categoryLabel(category: string): string {
  const key = CATEGORY_KEY[category];
  if (!key) return category;
  return t(key as Parameters<typeof t>[0]);
}

// ── Step 1: pick memberships ─────────────────────────────────────────────────

function StepMemberships({
  programs,
  loading,
  error,
  onRetry,
  onSkip,
  onDone,
}: {
  programs: Program[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSkip: () => void;
  onDone: (user: PublicUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return programs;
    const q = query.trim().toLowerCase();
    return programs.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (CATEGORY_KEY[p.category] ?? p.category).toLowerCase().includes(q),
    );
  }, [programs, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setSaveError("");
    try {
      let user: PublicUser | null = null;
      for (const programId of selected) {
        user = await api.addCatalogMembership({ programId, attributes: {} });
      }
      if (!user) {
        // Nothing selected — fetch current user state
        user = await api.me();
      }
      await api.trackActivation("membership_added").catch(() => undefined);
      onDone(user);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col" data-testid="onboarding-step-memberships">
      <h2 className="font-display text-2xl text-ink">{t("onboarding_select_heading")}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t("onboarding_select_subheading")}</p>

      <input
        className="field mt-4"
        type="search"
        placeholder={t("onboarding_search_placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="onboarding-search"
      />

      {loading ? (
        <p className="mt-6 text-center text-sm text-ink-muted" data-testid="onboarding-loading">
          {t("onboarding_loading")}
        </p>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-center">
          <p className="mb-3 text-sm text-red-600">{t("onboarding_error")}</p>
          <button className="btn-ghost text-sm" onClick={onRetry} data-testid="onboarding-retry">
            {t("onboarding_retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-muted" data-testid="onboarding-empty">
          {t("onboarding_empty_search", { query })}
        </p>
      ) : (
        <ul
          className="mt-4 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2"
          data-testid="onboarding-program-list"
        >
          {filtered.map((p) => {
            const checked = selected.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`onboarding-program-${p.id}`}
                  onClick={() => toggle(p.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    checked
                      ? "border-save bg-save-soft"
                      : "border-line bg-paper hover:border-ink/30 hover:bg-white"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs font-bold ${
                      checked ? "border-save bg-save text-white" : "border-line bg-white"
                    }`}
                    aria-hidden
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span>
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {categoryLabel(p.category)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {saveError && (
        <p className="mt-3 text-sm text-red-600" data-testid="onboarding-save-error">
          {saveError}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          className="btn-ghost flex-1 text-sm"
          onClick={onSkip}
          disabled={busy}
          data-testid="onboarding-skip"
        >
          {t("onboarding_skip")}
        </button>
        <button
          className="btn-primary flex-1"
          onClick={save}
          disabled={busy}
          data-testid="onboarding-save"
        >
          {busy ? t("onboarding_saving") : t("onboarding_save_continue")}
        </button>
      </div>
    </div>
  );
}

// ── Done step ────────────────────────────────────────────────────────────────

function StepDone({ user, onFinish }: { user: PublicUser; onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center text-center" data-testid="onboarding-step-done">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-save-soft">
        <span className="font-display text-2xl text-save">✓</span>
      </div>
      <h2 className="font-display text-2xl text-ink">{t("onboarding_finish_title")}</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {user.memberships.length > 0
          ? t("onboarding_finish_body")
          : t("onboarding_finish_empty")}
      </p>
      <button
        className="btn-primary mt-6"
        onClick={onFinish}
        data-testid="onboarding-finish"
      >
        {t("onboarding_finish_cta")}
      </button>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: WizardStep }) {
  const stepIndex = step === "memberships" ? 0 : 1;
  return (
    <div className="mb-6" data-testid="onboarding-progress">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-muted">
          {step !== "done" ? t("onboarding_progress", { current: stepIndex + 1, total: TOTAL_STEPS }) : ""}
        </span>
        <span className="text-xs text-ink-muted">
          {step === "memberships" ? t("onboarding_step_memberships") : t("onboarding_step_done")}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-line">
        <div
          className="h-1.5 rounded-full bg-save transition-all"
          style={{ width: step === "done" ? "100%" : `${((stepIndex + 1) / (TOTAL_STEPS + 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function OnboardingWizard({
  initialUser,
  onComplete,
}: {
  initialUser: PublicUser;
  onComplete: (user: PublicUser) => void;
}) {
  const [step, setStep] = useState<WizardStep>("memberships");
  const [user, setUser] = useState(initialUser);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function loadPrograms() {
    setLoading(true);
    setError(false);
    api
      .programs()
      .then(setPrograms)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setOnboardingState("in-progress");
    loadPrograms();
  }, []);

  function handleSkip() {
    setOnboardingState("skipped");
    onComplete(user);
  }

  function handleMembershipsDone(updatedUser: PublicUser) {
    setUser(updatedUser);
    setStep("done");
  }

  function handleFinish() {
    setOnboardingState("done");
    onComplete(user);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-grain">
      <div className="w-full max-w-lg rounded-xl2 border border-line bg-card p-8 shadow-2xl mx-4">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display text-xl">
            <span className="h-2 w-2 rounded-full bg-save" /> TrueRate
          </div>
          <div className="font-display text-lg text-ink">{t("onboarding_title")}</div>
        </div>

        <ProgressBar step={step} />

        {step === "memberships" ? (
          <StepMemberships
            programs={programs}
            loading={loading}
            error={error}
            onRetry={loadPrograms}
            onSkip={handleSkip}
            onDone={handleMembershipsDone}
          />
        ) : (
          <StepDone user={user} onFinish={handleFinish} />
        )}
      </div>
    </div>
  );
}
