"use client";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const TOKEN_KEY = "truerate_token";

export interface StructuredPerk {
  type: string;
  label: string;
  conditions?: Record<string, unknown>;
}

export interface BenefitValue {
  kind: "percentDiscount" | "fixedDiscount" | "perk" | "pointsEarn";
  percentOff?: number;
  amountOff?: number;
  perks?: string[];
  structuredPerks?: StructuredPerk[];
  conditions?: string;
}
export interface Benefit {
  id: string;
  scope: string;
  match: { brands?: string[]; domains?: string[]; propertyNames?: string[]; categories?: string[] };
  value: BenefitValue;
  source: "catalog" | "user-declared" | "provider-live";
  programId?: string;
}
export interface PublicMembership {
  id: string;
  label: string;
  programId?: string;
  tier?: string;
  attributes: Record<string, string>;
  benefits: Benefit[];
  hasCredential: boolean;
  status: "active" | "unverified" | "invalid";
}
export interface PublicUser {
  id: string;
  email: string;
  market: string;
  currency: string;
  memberships: PublicMembership[];
}
export interface ProgramField {
  key: string;
  label: string;
  type: "text" | "select" | "secret";
  options?: string[];
  placeholder?: string;
  secret?: boolean;
}
export interface Program {
  id: string;
  name: string;
  category: string;
  tiers?: string[];
  fields: ProgramField[];
  requiresCredential: boolean;
  summaryByTier: Record<string, string[]>;
}


export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface PerkBandEstimate {
  perkType: string;
  starBand: 3 | 4 | 5;
  estimatedUsd: number;
  isEstimate: true;
}

export interface PerkEstimates {
  [perkType: string]: { 3: PerkBandEstimate; 4: PerkBandEstimate; 5: PerkBandEstimate };
}

export interface CustomBenefitInput {
  label: string;
  benefits: { scope: string; match: Record<string, string[]>; value: BenefitValue }[];
}

export interface EditMembershipInput {
  tier?: string;
  attributes?: Record<string, string>;
  label?: string;
  benefits?: { scope: string; match: Record<string, string[]>; value: BenefitValue }[];
}

export const api = {
  async register(email: string, password: string, market: string) {
    const r = await req<{ token: string; user: PublicUser }>("/auth/register", {
      method: "POST", body: JSON.stringify({ email, password, market }),
    });
    setToken(r.token);
    return r.user;
  },
  async login(email: string, password: string) {
    const r = await req<{ token: string; user: PublicUser }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    setToken(r.token);
    return r.user;
  },
  me: () => req<{ user: PublicUser }>("/me").then((r) => r.user),
  programs: () => req<{ programs: Program[] }>("/programs").then((r) => r.programs),
  addCatalogMembership: (body: { programId: string; tier?: string; attributes: Record<string, string> }) =>
    req<{ user: PublicUser }>("/memberships", { method: "POST", body: JSON.stringify(body) }).then((r) => r.user),
  addCustomMembership: (body: CustomBenefitInput) =>
    req<{ user: PublicUser }>("/memberships", { method: "POST", body: JSON.stringify(body) }).then((r) => r.user),
  removeMembership: (id: string) =>
    req<{ user: PublicUser }>(`/memberships/${id}`, { method: "DELETE" }).then((r) => r.user),
  editMembership: (id: string, body: EditMembershipInput) =>
    req<{ user: PublicUser }>(`/memberships/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.user),
  perkEstimates: () =>
    req<{ estimates: PerkEstimates }>("/perks/estimates").then((r) => r.estimates),
  /** Emit an activation milestone event from the web client (fire-and-forget). */
  trackActivation: (event: "signup" | "membership_added" | "mcp_url_obtained" | "extension_connected") =>
    req<void>("/events/activation", { method: "POST", body: JSON.stringify({ event }) }).catch(() => undefined),
  updateSettings: (body: { market?: string; currency?: string }) =>
    req<{ user: PublicUser }>("/user/settings", { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.user),
};
