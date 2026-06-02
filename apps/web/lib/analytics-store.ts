// In-memory event store for MVP launch measurement.
// Replace with Cosmos DB container writes for durable cross-instance persistence.

import type { FunnelEventName } from "./analytics";

export interface StoredEvent {
  id: string;
  name: FunnelEventName;
  properties?: Record<string, string | boolean | number>;
  timestamp: string;
}

export interface FunnelReport {
  counts: Record<FunnelEventName, number>;
  conversionRates: {
    visitToSignUp: number | null;
    signUpToActivation: number | null;
    overallFunnel: number | null;
  };
  recentEvents: StoredEvent[];
}

const FUNNEL_STAGES: FunnelEventName[] = [
  "landing_visit",
  "sign_up",
  "membership_added",
  "mcp_connect",
  "extension_install",
];

const store: StoredEvent[] = [];
let seq = 0;

export function recordEvent(event: Omit<StoredEvent, "id">): StoredEvent {
  const stored: StoredEvent = { id: `evt_${++seq}`, ...event };
  store.push(stored);
  return stored;
}

export function getReport(): FunnelReport {
  const counts = Object.fromEntries(FUNNEL_STAGES.map((n) => [n, 0])) as Record<FunnelEventName, number>;
  for (const e of store) {
    if (e.name in counts) counts[e.name]++;
  }

  const visits = counts.landing_visit;
  const signUps = counts.sign_up;
  const activations = counts.membership_added;

  return {
    counts,
    conversionRates: {
      visitToSignUp: visits > 0 ? signUps / visits : null,
      signUpToActivation: signUps > 0 ? activations / signUps : null,
      overallFunnel: visits > 0 ? activations / visits : null,
    },
    recentEvents: store.slice(-50).reverse(),
  };
}

// Only for test teardown — not exported to production routes.
export function _clearEvents(): void {
  store.length = 0;
  seq = 0;
}
