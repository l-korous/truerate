"use client";

import { t } from "@/lib/i18n";
import { setOnboardingState } from "@/lib/onboarding";

export function OnboardingResumeBanner({ onResume }: { onResume: () => void }) {
  function dismiss() {
    setOnboardingState("done");
    onResume();
  }

  return (
    <div
      className="mb-6 flex items-center justify-between rounded-xl border border-save/30 bg-save-soft px-5 py-4"
      data-testid="onboarding-resume-banner"
    >
      <p className="text-sm font-medium text-ink">{t("onboarding_resume_banner")}</p>
      <div className="flex shrink-0 gap-3">
        <button
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
          onClick={dismiss}
          data-testid="onboarding-resume-dismiss"
        >
          Dismiss
        </button>
        <button
          className="btn-primary text-sm py-1.5 px-4"
          onClick={onResume}
          data-testid="onboarding-resume-cta"
        >
          {t("onboarding_resume_cta")}
        </button>
      </div>
    </div>
  );
}
