"use client";

import { useEffect, useState } from "react";
import { api, getToken, type PublicUser } from "@/lib/api";
import { track } from "@/lib/analytics";
import { AuthScreen } from "@/components/Auth";
import { Dashboard } from "@/components/Dashboard";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { getOnboardingState, shouldShowOnboarding, shouldShowResumeBanner } from "@/lib/onboarding";

type AppView = "loading" | "auth" | "onboarding" | "dashboard";

export default function Home() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AppView>("loading");

  useEffect(() => {
    track({ name: "landing_visit" });
    if (!getToken()) {
      setView("auth");
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => {
        setUser(u);
        const state = getOnboardingState();
        setView(shouldShowOnboarding(u.memberships.length, state, false) ? "onboarding" : "dashboard");
      })
      .catch(() => { setUser(null); setView("auth"); })
      .finally(() => setLoading(false));
  }, []);

  function handleAuth(u: PublicUser, isSignup: boolean) {
    setUser(u);
    const state = getOnboardingState();
    setView(shouldShowOnboarding(u.memberships.length, state, isSignup) ? "onboarding" : "dashboard");
  }

  function handleOnboardingComplete(u: PublicUser) {
    setUser(u);
    setView("dashboard");
  }

  function handleResumeOnboarding() {
    setView("onboarding");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <span className="font-display text-2xl text-ink-muted">TrueRate</span>
      </div>
    );
  }

  if (view === "auth" || !user) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  if (view === "onboarding") {
    return (
      <OnboardingWizard
        initialUser={user}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  const onboardingState = getOnboardingState();
  const showResumeBanner = shouldShowResumeBanner(onboardingState);

  return (
    <Dashboard
      user={user}
      onSignOut={() => { setUser(null); setView("auth"); }}
      showOnboardingBanner={showResumeBanner}
      onResumeOnboarding={handleResumeOnboarding}
    />
  );
}
