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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Admin catalog types -----------------------------------------------------

export interface CatalogProvenance {
  source: "manual-seed" | "scrape-proposal" | "partner-submission";
  sourceUrl?: string;
  asOf: string;
  scrapedAt?: string;
  submittedBy?: string;
  notes?: string;
}

export interface BenefitTemplate {
  scope: string;
  match?: { brands?: string[]; domains?: string[]; propertyNames?: string[]; categories?: string[] };
  value: BenefitValue;
}

export interface CatalogEntry {
  id: string;
  programId: string;
  version: number;
  isCurrent: boolean;
  status: "draft" | "in-review" | "published" | "archived";
  provenance: CatalogProvenance;
  region: string;
  name: string;
  category: string;
  defaultMatch: { brands?: string[]; domains?: string[]; propertyNames?: string[]; categories?: string[] };
  tiers?: string[];
  requiresCredential: boolean;
  fields: ProgramField[];
  benefits: Record<string, BenefitTemplate[]>;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  archivedAt?: string;
}

export interface CatalogEntryInput {
  programId: string;
  provenance: CatalogProvenance;
  region: string;
  name: string;
  category: string;
  defaultMatch: { brands?: string[]; domains?: string[]; propertyNames?: string[]; categories?: string[] };
  tiers?: string[];
  requiresCredential: boolean;
  fields: ProgramField[];
  benefits: Record<string, BenefitTemplate[]>;
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

  // ── MCP URL ────────────────────────────────────────────────────────────────
  /**
   * Issues or rotates the user's personal MCP URL.
   * Returns the raw URL + token exactly ONCE — the caller must save it.
   */
  issueMcpUrl: () =>
    req<{ url: string; token: string; createdAt: string }>("/me/mcp-url", { method: "POST" }),
  /** Returns status only — never returns the raw URL/token after initial issue. */
  getMcpUrlStatus: () =>
    req<{ active: false } | { active: true; createdAt: string; lastUsedAt?: string }>("/me/mcp-url"),
  /** Revokes the user's MCP URL token. */
  revokeMcpUrl: () =>
    req<void>("/me/mcp-url", { method: "DELETE" }),
};

// --- Partner portal types & API ----------------------------------------------

export type PartnerOrgStatus = "pending" | "active" | "rejected";
export type SubmissionStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected";
export type PartnerRole = "owner" | "editor";
export type ProgramCategory = "hotel" | "airline" | "rail" | "carRental" | "ota" | "card" | "subscription";

export interface PartnerOrg {
  id: string;
  name: string;
  country: string;
  contactEmail: string;
  status: PartnerOrgStatus;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
}

export interface PartnerOrgMember {
  userId: string;
  orgId: string;
  role: PartnerRole;
  addedAt: string;
}

export interface PartnerProgramDraft {
  name: string;
  category: ProgramCategory;
  region: string;
  sourceUrl?: string;
  tiers?: string[];
  fields: ProgramField[];
  benefits: Record<string, { scope: string; match?: Record<string, string[]>; value: BenefitValue }[]>;
}

export interface PartnerSubmission {
  id: string;
  orgId: string;
  submittedByUserId: string;
  status: SubmissionStatus;
  source: "partner" | "scraped";
  programDraft: PartnerProgramDraft;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
  publishedProgramId?: string;
}

export type PartnerDraftInput = PartnerProgramDraft & { orgId: string };

export const partnerApi = {
  createOrg: (body: { name: string; country: string; contactEmail: string }) =>
    req<{ org: PartnerOrg }>("/partner/orgs", { method: "POST", body: JSON.stringify(body) }),
  myOrgs: () =>
    req<{ orgs: PartnerOrg[]; memberships: PartnerOrgMember[] }>("/partner/orgs/mine"),
  listSubmissions: () =>
    req<{ submissions: PartnerSubmission[]; count: number }>("/partner/submissions"),
  createSubmission: (body: PartnerDraftInput) =>
    req<{ submission: PartnerSubmission }>("/partner/submissions", { method: "POST", body: JSON.stringify(body) }),
  getSubmission: (id: string) =>
    req<{ submission: PartnerSubmission }>(`/partner/submissions/${id}`),
  updateSubmission: (id: string, body: PartnerProgramDraft) =>
    req<{ submission: PartnerSubmission }>(`/partner/submissions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  submitForReview: (id: string) =>
    req<{ submission: PartnerSubmission }>(`/partner/submissions/${id}/submit`, { method: "POST" }),
};

// --- Admin catalog API (via Next.js proxy routes) ----------------------------

const ADMIN_BASE = "/api/admin/catalog";

async function adminReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminCatalogApi = {
  list: (status?: string) =>
    adminReq<{ entries: CatalogEntry[]; count: number }>(status ? `?status=${status}` : ""),
  create: (input: CatalogEntryInput) =>
    adminReq<{ entry: CatalogEntry }>("", { method: "POST", body: JSON.stringify(input) }),
  get: (programId: string) =>
    adminReq<{ entry: CatalogEntry }>(`/${programId}`),
  update: (programId: string, input: CatalogEntryInput) =>
    adminReq<{ entry: CatalogEntry }>(`/${programId}`, { method: "PUT", body: JSON.stringify(input) }),
  archive: (programId: string) =>
    adminReq<void>(`/${programId}`, { method: "DELETE" }),
  publish: (programId: string) =>
    adminReq<{ entry: CatalogEntry }>(`/${programId}/publish`, { method: "POST" }),
  history: (programId: string) =>
    adminReq<{ history: CatalogEntry[]; programId: string }>(`/${programId}/history`),
  restore: (programId: string, version: number) =>
    adminReq<{ entry: CatalogEntry }>(`/${programId}/restore/${version}`, { method: "POST" }),
};

// --- Admin feature flags API (via Next.js proxy routes) ----------------------

export interface FeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
  description?: string;
  environment?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FeatureFlagInput {
  key: string;
  label: string;
  enabled: boolean;
  description?: string;
  environment?: string;
}

async function adminFlagReq<T>(path: string, init?: RequestInit): Promise<T> {
  const base = "/api/admin/flags";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminFlagsApi = {
  list: () => adminFlagReq<{ flags: FeatureFlag[]; count: number }>(""),
  create: (input: FeatureFlagInput) =>
    adminFlagReq<{ flag: FeatureFlag }>("", { method: "POST", body: JSON.stringify(input) }),
  get: (key: string) => adminFlagReq<{ flag: FeatureFlag }>(`/${encodeURIComponent(key)}`),
  update: (key: string, input: FeatureFlagInput) =>
    adminFlagReq<{ flag: FeatureFlag }>(`/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(input) }),
  delete: (key: string) => adminFlagReq<void>(`/${encodeURIComponent(key)}`, { method: "DELETE" }),
};

// --- Admin app config API (via Next.js proxy routes) -------------------------

export interface AppConfig {
  key: string;
  label: string;
  value: string;
  description?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AppConfigInput {
  key: string;
  label: string;
  value: string;
  description?: string;
}

async function adminConfigReq<T>(path: string, init?: RequestInit): Promise<T> {
  const base = "/api/admin/config";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminConfigApi = {
  list: () => adminConfigReq<{ config: AppConfig[]; count: number }>(""),
  create: (input: AppConfigInput) =>
    adminConfigReq<{ config: AppConfig }>("", { method: "POST", body: JSON.stringify(input) }),
  get: (key: string) => adminConfigReq<{ config: AppConfig }>(`/${encodeURIComponent(key)}`),
  update: (key: string, input: AppConfigInput) =>
    adminConfigReq<{ config: AppConfig }>(`/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(input) }),
  delete: (key: string) => adminConfigReq<void>(`/${encodeURIComponent(key)}`, { method: "DELETE" }),
};

// --- Usage analytics / leaderboard API (via Next.js proxy route) -------------

export interface UsageBucket {
  key: string;
  count: number;
}

export interface UsageAggregation {
  total: number;
  byProvider: UsageBucket[];
  byPerk: UsageBucket[];
  byCountry: UsageBucket[];
  byDay: UsageBucket[];
}

// --- Public "CustomRates for your hotel" demo (no auth) -------------------------

export interface DemoDirectBooking {
  name: string;
  city?: string;
  country: string;
  kind?: string;
  realizationUrl: string;
}
export interface DemoProgram {
  programId: string;
  name: string;
  category: string;
  region?: string;
  topTier?: string;
  summary: string[];
  perkValues: { label: string; estUsd: number }[];
  realizationUrl?: string;
  /** Free to join — anyone can register and get the discount/perks. */
  openToAnyone?: boolean;
  /** Headline discount as a fraction (0.15 → 15%); 0 if perk-only. */
  percentOff?: number;
}
export interface DemoHotelResult {
  query: string;
  directBooking: DemoDirectBooking[];
  memberPrograms: DemoProgram[];
}
export interface PlatformStats {
  hotelsCovered: number;
  programs: number;
  countries: number;
  benefitSurfaces: number;
}

export const demoApi = {
  hotel: async (q: string): Promise<DemoHotelResult> => {
    const res = await fetch(`${API}/demo/hotel?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    return res.json() as Promise<DemoHotelResult>;
  },
  stats: async (): Promise<PlatformStats> => {
    const res = await fetch(`${API}/stats/overview`);
    if (!res.ok) throw new Error(`Stats failed (${res.status})`);
    return res.json() as Promise<PlatformStats>;
  },
};

export const adminUsageApi = {
  /** Aggregated usage; pass { country } for a per-country leaderboard, omit for global. */
  get: async (filter: { country?: string } = {}): Promise<UsageAggregation> => {
    const qs = new URLSearchParams();
    if (filter.country) qs.set("country", filter.country);
    const s = qs.toString();
    const res = await fetch(`/api/admin/analytics/usage${s ? `?${s}` : ""}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`;
      throw new Error(String(msg));
    }
    return res.json() as Promise<UsageAggregation>;
  },
};
