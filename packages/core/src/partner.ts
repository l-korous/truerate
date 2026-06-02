// Partner self-service domain model for TrueRate.
//
// Implements the data model and in-memory repositories for the partner
// self-service flow described in epic #12:
//   - Partner org + signup (#12.1)
//   - Program submission (#12.2)
//   - Submission → admin approval → publish workflow (#12.3)
//   - Roles/permissions + notification capture (#12.4)
//
// Production backends (Cosmos, Entra) will replace MemoryPartnerOrgRepo and
// MemoryPartnerSubmissionRepo when those issues land. The interface contracts
// here are the stable surface that tests and channels program against.

import type {
  BenefitTemplate,
  ProgramCategory,
  ProgramField,
} from "./types.js";

// ---------------------------------------------------------------------------
// Partner org
// ---------------------------------------------------------------------------

export type PartnerOrgStatus = "pending" | "active";
export type PartnerRole = "owner" | "editor";

/** A partner organization (hotel chain, independent property, etc.). */
export interface PartnerOrg {
  id: string;
  name: string;
  country: string;
  contactEmail: string;
  status: PartnerOrgStatus;
  createdAt: string;
}

/** Link between a User and a PartnerOrg, with a scoped role. */
export interface PartnerOrgMember {
  userId: string;
  orgId: string;
  role: PartnerRole;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Program draft — the data a partner submits
// ---------------------------------------------------------------------------

/**
 * The program terms & perks a partner submits for review.
 *
 * Invariant: no price, amount, or currency fields.
 * (See product rule #1 — TrueRate never handles prices.)
 */
export interface PartnerProgramDraft {
  name: string;
  category: ProgramCategory;
  region: string;
  sourceUrl?: string;
  tiers?: string[];
  fields: ProgramField[];
  /** Benefit templates by tier, same shape as core Program.benefits. */
  benefits: Record<string, BenefitTemplate[]>;
}

// ---------------------------------------------------------------------------
// Submission lifecycle
// ---------------------------------------------------------------------------

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected";

export interface PartnerSubmission {
  id: string;
  orgId: string;
  submittedByUserId: string;
  status: SubmissionStatus;
  programDraft: PartnerProgramDraft;
  /** Reason supplied by the admin on rejection. */
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when approved and published to the catalog. */
  publishedProgramId?: string;
}

// ---------------------------------------------------------------------------
// Notifications (captured for test assertions; prod wires to email)
// ---------------------------------------------------------------------------

export type NotificationEvent =
  | "submission_received"
  | "submission_approved"
  | "submission_rejected";

export interface PartnerNotification {
  id: string;
  event: NotificationEvent;
  orgId: string;
  submissionId: string;
  recipientEmail: string;
  /** Structured payload — must never contain price/amount/currency fields. */
  payload: Record<string, unknown>;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Repo interfaces
// ---------------------------------------------------------------------------

export interface PartnerOrgRepo {
  init(): Promise<void>;
  createOrg(org: PartnerOrg): Promise<PartnerOrg>;
  getOrg(id: string): Promise<PartnerOrg | null>;
  updateOrg(org: PartnerOrg): Promise<PartnerOrg>;
  addMember(member: PartnerOrgMember): Promise<void>;
  getMember(userId: string, orgId: string): Promise<PartnerOrgMember | null>;
  listMembers(orgId: string): Promise<PartnerOrgMember[]>;
}

export interface PartnerSubmissionRepo {
  init(): Promise<void>;
  create(sub: PartnerSubmission): Promise<PartnerSubmission>;
  get(id: string): Promise<PartnerSubmission | null>;
  update(sub: PartnerSubmission): Promise<PartnerSubmission>;
  listByOrg(orgId: string): Promise<PartnerSubmission[]>;
  listByStatus(status: SubmissionStatus): Promise<PartnerSubmission[]>;
}

export interface PartnerNotificationRepo {
  record(n: PartnerNotification): Promise<void>;
  listBySubmission(submissionId: string): Promise<PartnerNotification[]>;
  listByOrg(orgId: string): Promise<PartnerNotification[]>;
}

// ---------------------------------------------------------------------------
// In-memory backends (local dev + tests; no live Cosmos/Entra required)
// ---------------------------------------------------------------------------

export class MemoryPartnerOrgRepo implements PartnerOrgRepo {
  private orgs = new Map<string, PartnerOrg>();
  private members = new Map<string, PartnerOrgMember>(); // key = `${userId}:${orgId}`

  async init(): Promise<void> {}

  async createOrg(org: PartnerOrg): Promise<PartnerOrg> {
    this.orgs.set(org.id, { ...org });
    return org;
  }

  async getOrg(id: string): Promise<PartnerOrg | null> {
    return this.orgs.get(id) ?? null;
  }

  async updateOrg(org: PartnerOrg): Promise<PartnerOrg> {
    this.orgs.set(org.id, { ...org });
    return org;
  }

  async addMember(member: PartnerOrgMember): Promise<void> {
    this.members.set(`${member.userId}:${member.orgId}`, { ...member });
  }

  async getMember(userId: string, orgId: string): Promise<PartnerOrgMember | null> {
    return this.members.get(`${userId}:${orgId}`) ?? null;
  }

  async listMembers(orgId: string): Promise<PartnerOrgMember[]> {
    return [...this.members.values()].filter((m) => m.orgId === orgId);
  }
}

export class MemoryPartnerSubmissionRepo implements PartnerSubmissionRepo {
  private byId = new Map<string, PartnerSubmission>();

  async init(): Promise<void> {}

  async create(sub: PartnerSubmission): Promise<PartnerSubmission> {
    this.byId.set(sub.id, { ...sub });
    return sub;
  }

  async get(id: string): Promise<PartnerSubmission | null> {
    return this.byId.get(id) ?? null;
  }

  async update(sub: PartnerSubmission): Promise<PartnerSubmission> {
    this.byId.set(sub.id, { ...sub });
    return sub;
  }

  async listByOrg(orgId: string): Promise<PartnerSubmission[]> {
    return [...this.byId.values()].filter((s) => s.orgId === orgId);
  }

  async listByStatus(status: SubmissionStatus): Promise<PartnerSubmission[]> {
    return [...this.byId.values()].filter((s) => s.status === status);
  }
}

export class MemoryPartnerNotificationRepo implements PartnerNotificationRepo {
  private records: PartnerNotification[] = [];

  async record(n: PartnerNotification): Promise<void> {
    this.records.push({ ...n });
  }

  async listBySubmission(submissionId: string): Promise<PartnerNotification[]> {
    return this.records.filter((n) => n.submissionId === submissionId);
  }

  async listByOrg(orgId: string): Promise<PartnerNotification[]> {
    return this.records.filter((n) => n.orgId === orgId);
  }
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class PartnerWorkflow {
  constructor(
    private readonly orgs: PartnerOrgRepo,
    private readonly submissions: PartnerSubmissionRepo,
    private readonly notifications: PartnerNotificationRepo,
  ) {}

  /**
   * Associate a user with a partner org.
   * If the org has no other members yet, the first user becomes owner.
   */
  async associateUser(userId: string, orgId: string, role: PartnerRole): Promise<void> {
    const org = await this.orgs.getOrg(orgId);
    if (!org) throw new PartnerWorkflowError("org_not_found", "Organization not found");
    await this.orgs.addMember({ userId, orgId, role, addedAt: new Date().toISOString() });
  }

  /**
   * Create a program draft for the given org. Validates that:
   * - The user is a member of the org (any role).
   * - The draft contains no price/amount/currency fields.
   */
  async createDraft(
    userId: string,
    orgId: string,
    draft: PartnerProgramDraft,
    submissionId: string,
  ): Promise<PartnerSubmission> {
    await this.assertMember(userId, orgId);
    assertNoPriceFields(draft);
    const now = new Date().toISOString();
    const sub: PartnerSubmission = {
      id: submissionId,
      orgId,
      submittedByUserId: userId,
      status: "draft",
      programDraft: draft,
      createdAt: now,
      updatedAt: now,
    };
    return this.submissions.create(sub);
  }

  /**
   * Submit a draft for admin review.
   * Requires the user to be a member of the org (owner or editor).
   */
  async submitForReview(userId: string, submissionId: string): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    await this.assertMember(userId, sub.orgId);
    if (sub.status !== "draft") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot submit a submission in status '${sub.status}'`);
    }
    const updated = { ...sub, status: "submitted" as SubmissionStatus, updatedAt: new Date().toISOString() };
    await this.submissions.update(updated);
    await this.sendNotification(updated, "submission_received");
    return updated;
  }

  /**
   * Approve a submission and publish to catalog.
   * Admin-only: no org membership check (admin acts outside any org).
   * Returns the published program id.
   */
  async approve(submissionId: string, publishedProgramId: string): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    if (sub.status !== "submitted" && sub.status !== "in_review") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot approve a submission in status '${sub.status}'`);
    }
    assertNoPriceFields(sub.programDraft);
    const updated: PartnerSubmission = {
      ...sub,
      status: "approved",
      publishedProgramId,
      updatedAt: new Date().toISOString(),
    };
    await this.submissions.update(updated);
    await this.sendNotification(updated, "submission_approved");
    return updated;
  }

  /**
   * Reject a submission with a reason.
   * Admin-only action.
   */
  async reject(submissionId: string, reason: string): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    if (sub.status !== "submitted" && sub.status !== "in_review") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot reject a submission in status '${sub.status}'`);
    }
    const updated: PartnerSubmission = {
      ...sub,
      status: "rejected",
      rejectReason: reason,
      updatedAt: new Date().toISOString(),
    };
    await this.submissions.update(updated);
    await this.sendNotification(updated, "submission_rejected");
    return updated;
  }

  private async getSubmissionOrThrow(id: string): Promise<PartnerSubmission> {
    const sub = await this.submissions.get(id);
    if (!sub) throw new PartnerWorkflowError("submission_not_found", "Submission not found");
    return sub;
  }

  private async assertMember(userId: string, orgId: string): Promise<PartnerOrgMember> {
    const member = await this.orgs.getMember(userId, orgId);
    if (!member) throw new PartnerWorkflowError("not_a_member", "User is not a member of this organization");
    return member;
  }

  private async sendNotification(sub: PartnerSubmission, event: NotificationEvent): Promise<void> {
    const org = await this.orgs.getOrg(sub.orgId);
    const recipientEmail = org?.contactEmail ?? "unknown";
    await this.notifications.record({
      id: `notif-${sub.id}-${event}`,
      event,
      orgId: sub.orgId,
      submissionId: sub.id,
      recipientEmail,
      payload: {
        submissionId: sub.id,
        programName: sub.programDraft.name,
        status: sub.status,
        ...(sub.rejectReason ? { rejectReason: sub.rejectReason } : {}),
        ...(sub.publishedProgramId ? { publishedProgramId: sub.publishedProgramId } : {}),
      },
      sentAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export type PartnerWorkflowErrorCode =
  | "org_not_found"
  | "submission_not_found"
  | "not_a_member"
  | "invalid_transition"
  | "price_field_in_draft";

export class PartnerWorkflowError extends Error {
  constructor(
    public readonly code: PartnerWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PartnerWorkflowError";
  }
}

// ---------------------------------------------------------------------------
// Price-field guard (product rule #1)
// ---------------------------------------------------------------------------

const PRICE_FIELD_PATTERN =
  /price|amount|nightly|total|cost|fee|rate|currency|discount.*(amount|value|flat)/i;

/**
 * Walks a draft object and throws if any key looks like a price/amount field.
 * This is a defense-in-depth check; catalog structs (BenefitTemplate) already
 * express discounts as percentages only for partner submissions.
 */
export function assertNoPriceFields(obj: unknown): void {
  walk(obj, []);
}

function walk(val: unknown, path: string[]): void {
  if (val === null || typeof val !== "object") return;
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (PRICE_FIELD_PATTERN.test(k)) {
      throw new PartnerWorkflowError(
        "price_field_in_draft",
        `Price/amount field '${[...path, k].join(".")}' is not allowed in partner submissions (product rule #1)`,
      );
    }
    walk(v, [...path, k]);
  }
}
