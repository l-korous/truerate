const ONBOARDING_KEY = "truerate_onboarding";

export type OnboardingState = "pending" | "in-progress" | "skipped" | "done";

export function getOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return "pending";
  const v = localStorage.getItem(ONBOARDING_KEY);
  if (v === "done") return "done";
  if (v === "in-progress") return "in-progress";
  if (v === "skipped") return "skipped";
  return "pending";
}

export function setOnboardingState(state: OnboardingState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ONBOARDING_KEY, state);
}

export function clearOnboardingState(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ONBOARDING_KEY);
}

/**
 * Returns true when the wizard should be shown:
 * - new signup, OR state is in-progress, OR user has no memberships and has
 *   never started — but not when explicitly done or skipped (skipped shows a banner instead).
 */
export function shouldShowOnboarding(
  membershipCount: number,
  state: OnboardingState,
  isNewSignup: boolean,
): boolean {
  if (state === "done" || state === "skipped") return false;
  if (isNewSignup) return true;
  if (state === "in-progress") return true;
  if (membershipCount === 0 && state === "pending") return true;
  return false;
}

/** Returns true when a resume banner should appear (user skipped but not finished). */
export function shouldShowResumeBanner(state: OnboardingState): boolean {
  return state === "skipped";
}
