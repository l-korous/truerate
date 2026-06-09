"use client";

import { useEffect, useState } from "react";
import { getConsent, setConsent, type ConsentState } from "@/lib/analytics";

export function CookieBanner() {
  const [consent, setConsentState] = useState<ConsentState>("pending");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConsentState(getConsent());
  }, []);

  if (!mounted || consent !== "pending") return null;

  function accept() {
    setConsent("granted");
    setConsentState("granted");
  }

  function decline() {
    setConsent("denied");
    setConsentState("denied");
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      aria-describedby="cookie-banner-desc"
      data-testid="cookie-banner"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-paper px-6 py-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p id="cookie-banner-desc" className="text-sm text-ink-muted">
          We use analytics to understand how people discover and activate CustomRates. No prices,
          no personal data beyond what you share during sign-up.{" "}
          <a
            href="/privacy"
            className="underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
            data-testid="cookie-privacy-link"
          >
            Privacy policy
          </a>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            onClick={decline}
            data-testid="cookie-decline"
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted hover:border-ink/30 hover:text-ink"
          >
            Decline
          </button>
          <button
            onClick={accept}
            data-testid="cookie-accept"
            className="btn-primary px-4 py-2 text-sm"
          >
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
