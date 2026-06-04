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

import type { EmailSender } from "./email.js";
import type {
  BenefitMatch,
  BenefitTemplate,
  ProgramCategory,
  ProgramField,
} from "./types.js";

// ---------------------------------------------------------------------------
// Partner org
// ---------------------------------------------------------------------------

export type PartnerOrgStatus = "pending" | "active" | "rejected";
export type PartnerRole = "owner" | "editor";

/** A partner organization (hotel chain, independent property, etc.). */
export interface PartnerOrg {
  id: string;
  name: string;
  country: string;
  contactEmail: string;
  status: PartnerOrgStatus;
  createdAt: string;
  /** Set when the admin approves the org. */
  approvedAt?: string;
  /** Admin user id that approved. */
  approvedBy?: string;
  /** Set when the admin rejects the org. */
  rejectedAt?: string;
  /** Admin user id that rejected. */
  rejectedBy?: string;
  /** Reason supplied by the admin on rejection. */
  rejectReason?: string;
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
  /**
   * How this program's benefits are recognised on the web (shared default).
   * If omitted at publication time, defaults to matching on the program name as a brand.
   */
  defaultMatch?: BenefitMatch;
  /**
   * Whether a stored credential (API key, membership login) is expected.
   * Defaults to false if omitted.
   */
  requiresCredential?: boolean;
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

export type SubmissionSource = "partner" | "scraped";

export interface PartnerSubmission {
  id: string;
  orgId: string;
  submittedByUserId: string;
  status: SubmissionStatus;
  /** Whether the submission came from a partner or the scraping system. */
  source: SubmissionSource;
  programDraft: PartnerProgramDraft;
  /** Reason supplied by the admin on rejection. */
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when approved and published to the catalog. */
  publishedProgramId?: string;
  /** Admin user id that approved this submission. */
  approvedBy?: string;
  /** Admin user id that rejected this submission. */
  rejectedBy?: string;
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
  listByStatus(status: PartnerOrgStatus): Promise<PartnerOrg[]>;
  /** Upsert a member record (keyed on userId:orgId). */
  addMember(member: PartnerOrgMember): Promise<void>;
  getMember(userId: string, orgId: string): Promise<PartnerOrgMember | null>;
  /** Remove a member from an org. No-op if not present. */
  removeMember(userId: string, orgId: string): Promise<void>;
  listMembers(orgId: string): Promise<PartnerOrgMember[]>;
  /** Return all org memberships for a given user (reverse lookup). */
  listOrgMemberships(userId: string): Promise<PartnerOrgMember[]>;
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

  async removeMember(userId: string, orgId: string): Promise<void> {
    this.members.delete(`${userId}:${orgId}`);
  }

  async listByStatus(status: PartnerOrgStatus): Promise<PartnerOrg[]> {
    return [...this.orgs.values()].filter((o) => o.status === status);
  }

  async listMembers(orgId: string): Promise<PartnerOrgMember[]> {
    return [...this.members.values()].filter((m) => m.orgId === orgId);
  }

  async listOrgMemberships(userId: string): Promise<PartnerOrgMember[]> {
    return [...this.members.values()].filter((m) => m.userId === userId);
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
    private readonly emailSender?: EmailSender,
  ) {}

  /**
   * Associate a user with a partner org.
   * If the org has no other members yet, the first user becomes owner.
   * Admin/system-level — no ownership check (used during onboarding).
   */
  async associateUser(userId: string, orgId: string, role: PartnerRole): Promise<void> {
    const org = await this.orgs.getOrg(orgId);
    if (!org) throw new PartnerWorkflowError("org_not_found", "Organization not found");
    await this.orgs.addMember({ userId, orgId, role, addedAt: new Date().toISOString() });
  }

  /**
   * Add a member to an org.  Requires the calling user to be an owner.
   */
  async addMember(actorId: string, orgId: string, newUserId: string, role: PartnerRole): Promise<PartnerOrgMember> {
    await this.assertOwner(actorId, orgId);
    const existing = await this.orgs.getMember(newUserId, orgId);
    if (existing) {
      throw new PartnerWorkflowError("invalid_transition", "User is already a member of this organization");
    }
    const member: PartnerOrgMember = { userId: newUserId, orgId, role, addedAt: new Date().toISOString() };
    await this.orgs.addMember(member);
    return member;
  }

  /**
   * Remove a member from an org.  Requires the calling user to be an owner.
   * An owner cannot remove themselves if they are the last owner.
   */
  async removeMember(actorId: string, orgId: string, targetUserId: string): Promise<void> {
    await this.assertOwner(actorId, orgId);
    const target = await this.orgs.getMember(targetUserId, orgId);
    if (!target) throw new PartnerWorkflowError("not_a_member", "Target user is not a member of this organization");

    // Prevent removing the last owner
    if (target.role === "owner") {
      const owners = (await this.orgs.listMembers(orgId)).filter((m) => m.role === "owner");
      if (owners.length <= 1) {
        throw new PartnerWorkflowError("invalid_transition", "Cannot remove the last owner of an organization");
      }
    }

    await this.orgs.removeMember(targetUserId, orgId);
  }

  /**
   * Update a member's role.  Requires the calling user to be an owner.
   * An owner cannot downgrade themselves if they are the last owner.
   */
  async updateMemberRole(actorId: string, orgId: string, targetUserId: string, newRole: PartnerRole): Promise<PartnerOrgMember> {
    await this.assertOwner(actorId, orgId);
    const target = await this.orgs.getMember(targetUserId, orgId);
    if (!target) throw new PartnerWorkflowError("not_a_member", "Target user is not a member of this organization");

    // Prevent downgrading the last owner
    if (target.role === "owner" && newRole !== "owner") {
      const owners = (await this.orgs.listMembers(orgId)).filter((m) => m.role === "owner");
      if (owners.length <= 1) {
        throw new PartnerWorkflowError("invalid_transition", "Cannot demote the last owner of an organization");
      }
    }

    const updated: PartnerOrgMember = { ...target, role: newRole };
    await this.orgs.addMember(updated); // addMember is upsert-by-key in all repo impls
    return updated;
  }

  /**
   * Approve a pending partner org, making them eligible to submit programs.
   * Admin-only: no org membership check.
   */
  async approveOrg(orgId: string, adminId: string): Promise<PartnerOrg> {
    const org = await this.orgs.getOrg(orgId);
    if (!org) throw new PartnerWorkflowError("org_not_found", "Organization not found");
    if (org.status !== "pending") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot approve an org in status '${org.status}'`);
    }
    const updated: PartnerOrg = {
      ...org,
      status: "active",
      approvedAt: new Date().toISOString(),
      approvedBy: adminId,
    };
    return this.orgs.updateOrg(updated);
  }

  /**
   * Reject a pending partner org with a reason.
   * Admin-only: no org membership check.
   */
  async rejectOrg(orgId: string, adminId: string, reason: string): Promise<PartnerOrg> {
    const org = await this.orgs.getOrg(orgId);
    if (!org) throw new PartnerWorkflowError("org_not_found", "Organization not found");
    if (org.status !== "pending") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot reject an org in status '${org.status}'`);
    }
    const updated: PartnerOrg = {
      ...org,
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      rejectedBy: adminId,
      rejectReason: reason,
    };
    return this.orgs.updateOrg(updated);
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
    source: SubmissionSource = "partner",
  ): Promise<PartnerSubmission> {
    await this.assertMember(userId, orgId);
    assertNoPriceFields(draft);
    const now = new Date().toISOString();
    const sub: PartnerSubmission = {
      id: submissionId,
      orgId,
      submittedByUserId: userId,
      status: "draft",
      source,
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
   * Admin edit: update the program draft on a submission before approval.
   * Allowed in any pre-decision status (draft, submitted, in_review).
   * Admin-only: no org membership check.
   */
  async adminEdit(submissionId: string, patch: Partial<PartnerProgramDraft>): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    if (sub.status === "approved" || sub.status === "rejected") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot edit a submission in status '${sub.status}'`);
    }
    const merged = { ...sub.programDraft, ...patch };
    assertNoPriceFields(merged);
    const updated: PartnerSubmission = {
      ...sub,
      programDraft: merged,
      updatedAt: new Date().toISOString(),
    };
    return this.submissions.update(updated);
  }

  /**
   * Approve a submission and publish to catalog.
   * Admin-only: no org membership check (admin acts outside any org).
   * Returns the published program id.
   */
  async approve(submissionId: string, publishedProgramId: string, adminId?: string): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    if (sub.status !== "submitted" && sub.status !== "in_review") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot approve a submission in status '${sub.status}'`);
    }
    assertNoPriceFields(sub.programDraft);
    const updated: PartnerSubmission = {
      ...sub,
      status: "approved",
      publishedProgramId,
      approvedBy: adminId,
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
  async reject(submissionId: string, reason: string, adminId?: string): Promise<PartnerSubmission> {
    const sub = await this.getSubmissionOrThrow(submissionId);
    if (sub.status !== "submitted" && sub.status !== "in_review") {
      throw new PartnerWorkflowError("invalid_transition", `Cannot reject a submission in status '${sub.status}'`);
    }
    const updated: PartnerSubmission = {
      ...sub,
      status: "rejected",
      rejectReason: reason,
      rejectedBy: adminId,
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

  private async assertOwner(userId: string, orgId: string): Promise<PartnerOrgMember> {
    const member = await this.orgs.getMember(userId, orgId);
    if (!member) throw new PartnerWorkflowError("not_a_member", "User is not a member of this organization");
    if (member.role !== "owner") throw new PartnerWorkflowError("not_an_owner", "Only org owners can perform this action");
    return member;
  }

  private async sendNotification(sub: PartnerSubmission, event: NotificationEvent): Promise<void> {
    const org = await this.orgs.getOrg(sub.orgId);
    const recipientEmail = org?.contactEmail ?? "unknown";
    const payload: Record<string, unknown> = {
      submissionId: sub.id,
      programName: sub.programDraft.name,
      status: sub.status,
      ...(sub.rejectReason ? { rejectReason: sub.rejectReason } : {}),
      ...(sub.publishedProgramId ? { publishedProgramId: sub.publishedProgramId } : {}),
    };

    await this.notifications.record({
      id: `notif-${sub.id}-${event}`,
      event,
      orgId: sub.orgId,
      submissionId: sub.id,
      recipientEmail,
      payload,
      sentAt: new Date().toISOString(),
    });

    if (this.emailSender && recipientEmail !== "unknown") {
      const { subject, text } = buildEmailContent(event, sub.programDraft.name, sub.rejectReason, sub.publishedProgramId);
      // Fire-and-forget: email delivery failures don't break the workflow transaction.
      this.emailSender.send({ to: recipientEmail, subject, text }).catch(() => { /* logged by transport */ });
    }
  }
}

// ---------------------------------------------------------------------------
// Email content builder (product rule #1: no prices in any notification)
// ---------------------------------------------------------------------------

function buildEmailContent(
  event: NotificationEvent,
  programName: string,
  rejectReason?: string,
  publishedProgramId?: string,
): { subject: string; text: string } {
  switch (event) {
    case "submission_received":
      return {
        subject: `TrueRate: Submission received — ${programName}`,
        text: [
          `Your submission for "${programName}" has been received and is pending review.`,
          "",
          "You will be notified when the status changes.",
          "",
          "— The TrueRate team",
        ].join("\n"),
      };
    case "submission_approved":
      return {
        subject: `TrueRate: Submission approved — ${programName}`,
        text: [
          `Great news! Your submission for "${programName}" has been approved and published to the TrueRate catalog.`,
          ...(publishedProgramId ? [``, `Program ID: ${publishedProgramId}`] : []),
          "",
          "Thank you for contributing to TrueRate.",
          "",
          "— The TrueRate team",
        ].join("\n"),
      };
    case "submission_rejected":
      return {
        subject: `TrueRate: Submission not approved — ${programName}`,
        text: [
          `Unfortunately, your submission for "${programName}" was not approved.`,
          ...(rejectReason ? [``, `Reason: ${rejectReason}`] : []),
          "",
          "Please update your submission and resubmit, or contact support if you have questions.",
          "",
          "— The TrueRate team",
        ].join("\n"),
      };
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export type PartnerWorkflowErrorCode =
  | "org_not_found"
  | "submission_not_found"
  | "not_a_member"
  | "not_an_owner"
  | "invalid_transition"
  | "price_field_in_draft"
  | "org_already_processed";

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

// ---------------------------------------------------------------------------
// Singleton repo factories (mirrors getCatalogRepo / getUserRepo pattern)
// ---------------------------------------------------------------------------

let _orgRepo: PartnerOrgRepo | null = null;
let _submissionRepo: PartnerSubmissionRepo | null = null;
let _notificationRepo: PartnerNotificationRepo | null = null;

export async function getPartnerOrgRepo(): Promise<PartnerOrgRepo> {
  if (_orgRepo) return _orgRepo;
  _orgRepo = new MemoryPartnerOrgRepo();
  await _orgRepo.init();
  return _orgRepo;
}

export async function getPartnerSubmissionRepo(): Promise<PartnerSubmissionRepo> {
  if (_submissionRepo) return _submissionRepo;
  _submissionRepo = new MemoryPartnerSubmissionRepo();
  await _submissionRepo.init();
  return _submissionRepo;
}

export async function getPartnerNotificationRepo(): Promise<PartnerNotificationRepo> {
  if (_notificationRepo) return _notificationRepo;
  _notificationRepo = new MemoryPartnerNotificationRepo();
  return _notificationRepo;
}

export function resetPartnerRepos(): void {
  _orgRepo = null;
  _submissionRepo = null;
  _notificationRepo = null;
}

let _workflow: PartnerWorkflow | null = null;

export async function getPartnerWorkflow(emailSender?: EmailSender): Promise<PartnerWorkflow> {
  if (_workflow) return _workflow;
  const [orgs, subs, notifs] = await Promise.all([
    getPartnerOrgRepo(),
    getPartnerSubmissionRepo(),
    getPartnerNotificationRepo(),
  ]);
  _workflow = new PartnerWorkflow(orgs, subs, notifs, emailSender);
  return _workflow;
}

export function resetPartnerWorkflow(): void {
  _workflow = null;
  resetPartnerRepos();
}
