"use client";

const CONSENT_KEY = "truerate_analytics_consent";

export type FunnelEventName =
  | "landing_visit"
  | "sign_up"
  | "membership_added"
  | "mcp_connect"
  | "extension_install";

export interface FunnelEvent {
  name: FunnelEventName;
  properties?: Record<string, string | boolean | number>;
  timestamp?: string;
}

export type ConsentState = "granted" | "denied" | "pending";

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return "pending";
  const v = localStorage.getItem(CONSENT_KEY);
  if (v === "granted") return "granted";
  if (v === "denied") return "denied";
  return "pending";
}

export function setConsent(state: "granted" | "denied"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_KEY, state);
}

export async function track(event: FunnelEvent): Promise<void> {
  if (typeof window === "undefined") return;
  if (getConsent() !== "granted") return;
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
    });
  } catch {
    // Fire-and-forget; never throw from analytics
  }
}
