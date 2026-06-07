// Admin review queue for scraped proposals (issue #106).
//
// Scraped proposals are PartnerSubmissions with source="scraped" created by the
// scraping pipeline (#11.3). This module provides the admin review API:
//   POST   /admin/proposals          — ingest a scraped proposal
//   GET    /admin/proposals          — list proposals (default ?status=submitted)
//   GET    /admin/proposals/:id      — view a proposal (with provenance + source link)
//   PUT    /admin/proposals/:id      — edit before approval
//   POST   /admin/proposals/:id/approve — approve → publish via catalog versioning
//   POST   /admin/proposals/:id/reject  — reject with reason
//
// All endpoints require x-admin-secret (CatalogEditor role).
// Approved proposals publish with "scrape-proposal" provenance — never prices (rule #1).

import { Hono } from "hono";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  getCatalogRepo,
  getPartnerSubmissionRepo,
  getPartnerWorkflow,
  getAuditRepo,
  PartnerWorkflowError,
  type SubmissionStatus,
} from "@truerate/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContext = any;

export const proposalRoutes = new Hono();

// ---------------------------------------------------------------------------
// Auth helpers (mirrors app.ts — admin secret gate)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireAdmin(c: AnyContext): Response | null {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("x-admin-secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adminActor(c: AnyContext): string {
  return c.req.header("x-admin-actor") ?? "admin";
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

async function parseBody<T>(
  schema: z.ZodType<T>,
  c: { req: { json(): Promise<unknown> } },
): Promise<T | Response> {
  const raw = await (c.req.json() as Promise<unknown>).catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return Response.json(
      { error: "validation_failed", issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Price-field guard (product rule #1)
// ---------------------------------------------------------------------------

const DISALLOWED_PRICE_FIELDS = new Set([
  "price", "prices",
  "nightly", "nightlyRate", "nightlyAmount",
  "totalPrice", "totalAmount",
  "memberPrice", "memberRate",
  "finalPrice", "finalRate", "finalAmount",
  "basePrice", "baseRate",
  "discountedPrice", "discountedRate",
  "roomPrice", "roomRate",
]);

function findPriceField(obj: unknown, path = ""): string | null {
  if (obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const found = findPriceField(obj[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DISALLOWED_PRICE_FIELDS.has(key)) return path ? `${path}.${key}` : key;
    const found = findPriceField((obj as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ProposalIngestSchema = z.object({
  /** Optional client-supplied id; server generates one when omitted. */
  id: z.string().min(1).optional(),
  programDraft: z.record(z.unknown()),
});

const ProposalApproveSchema = z.object({
  publishedProgramId: z.string().min(1, "publishedProgramId is required"),
  adminId: z.string().min(1).optional(),
});

const ProposalRejectSchema = z.object({
  reason: z.string().min(1, "reason is required"),
  adminId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// POST /admin/proposals — ingest a scraped proposal
// ---------------------------------------------------------------------------

proposalRoutes.post("/admin/proposals", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const parsed = await parseBody(ProposalIngestSchema, c);
  if (parsed instanceof Response) return parsed;

  const priceField = findPriceField(parsed.programDraft);
  if (priceField) {
    return c.json({ error: "price_field_not_allowed", field: priceField }, 400);
  }

  const actor = adminActor(c);
  const workflow = await getPartnerWorkflow();
  try {
    const proposal = await workflow.createScrapedProposal(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.programDraft as any,
      parsed.id ?? uuid(),
    );

    const audit = await getAuditRepo();
    await audit.append({
      actor,
      action: "admin.proposal.ingest",
      targetId: proposal.id,
      targetType: "submission",
      notes: `scraped proposal ingested for program "${(parsed.programDraft as { name?: string }).name ?? "unknown"}"`,
    });

    return c.json({ proposal }, 201);
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      return c.json({ error: err.code, message: err.message }, 400);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /admin/proposals — list scraped proposals; optional ?status=
// ---------------------------------------------------------------------------

proposalRoutes.get("/admin/proposals", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const status = (c.req.query("status") ?? "submitted") as SubmissionStatus;
  const repo = await getPartnerSubmissionRepo();
  const proposals = await repo.listBySource("scraped", status);
  return c.json({ proposals, count: proposals.length });
});

// ---------------------------------------------------------------------------
// GET /admin/proposals/:id — view a proposal with provenance + source link
// ---------------------------------------------------------------------------

proposalRoutes.get("/admin/proposals/:id", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const repo = await getPartnerSubmissionRepo();
  const proposal = await repo.get(c.req.param("id"));
  if (!proposal || proposal.source !== "scraped") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({
    proposal,
    provenance: {
      source: "scrape-proposal",
      sourceUrl: proposal.programDraft.sourceUrl ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/proposals/:id — edit before approval
// ---------------------------------------------------------------------------

proposalRoutes.put("/admin/proposals/:id", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const parsed = await parseBody(z.object({ programDraft: z.record(z.unknown()) }), c);
  if (parsed instanceof Response) return parsed;

  const priceField = findPriceField(parsed.programDraft);
  if (priceField) {
    return c.json({ error: "price_field_not_allowed", field: priceField }, 400);
  }

  // Verify it's a scraped proposal before delegating to workflow
  const repo = await getPartnerSubmissionRepo();
  const existing = await repo.get(c.req.param("id"));
  if (!existing || existing.source !== "scraped") {
    return c.json({ error: "not_found" }, 404);
  }

  const actor = adminActor(c);
  const workflow = await getPartnerWorkflow();
  try {
    const proposal = await workflow.adminEdit(
      c.req.param("id"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.programDraft as any,
    );

    const audit = await getAuditRepo();
    await audit.append({
      actor,
      action: "admin.proposal.edit",
      targetId: proposal.id,
      targetType: "submission",
      notes: "admin edited scraped proposal draft",
    });

    return c.json({ proposal });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "submission_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /admin/proposals/:id/approve — approve and publish to catalog
// ---------------------------------------------------------------------------

proposalRoutes.post("/admin/proposals/:id/approve", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const parsed = await parseBody(ProposalApproveSchema, c);
  if (parsed instanceof Response) return parsed;

  // Verify it's a scraped proposal
  const repo = await getPartnerSubmissionRepo();
  const existing = await repo.get(c.req.param("id"));
  if (!existing || existing.source !== "scraped") {
    return c.json({ error: "not_found" }, 404);
  }

  const actor = adminActor(c);
  const workflow = await getPartnerWorkflow();
  try {
    const proposal = await workflow.approve(
      c.req.param("id"),
      parsed.publishedProgramId,
      parsed.adminId ?? actor,
    );

    // Publish to catalog via the versioning path (#10.4) with scrape-proposal provenance.
    const draft = proposal.programDraft;
    const catalogRepo = await getCatalogRepo();
    await catalogRepo.upsertDraft({
      programId: parsed.publishedProgramId,
      provenance: {
        source: "scrape-proposal",
        sourceUrl: draft.sourceUrl,
        asOf: new Date().toISOString().slice(0, 7),
        notes: `Approved from scraped proposal ${proposal.id}`,
      },
      region: draft.region,
      name: draft.name,
      category: draft.category,
      defaultMatch: draft.defaultMatch ?? { brands: [draft.name] },
      tiers: draft.tiers,
      requiresCredential: draft.requiresCredential ?? false,
      fields: draft.fields,
      benefits: draft.benefits,
    });
    const catalogEntry = await catalogRepo.publish(parsed.publishedProgramId);

    const audit = await getAuditRepo();
    await audit.append({
      actor,
      action: "admin.proposal.approve",
      targetId: proposal.id,
      targetType: "submission",
      before: { status: "submitted" },
      after: { status: proposal.status, publishedProgramId: proposal.publishedProgramId },
    });

    return c.json({ proposal, catalogEntry });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "submission_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /admin/proposals/:id/reject — reject with reason
// ---------------------------------------------------------------------------

proposalRoutes.post("/admin/proposals/:id/reject", async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const parsed = await parseBody(ProposalRejectSchema, c);
  if (parsed instanceof Response) return parsed;

  // Verify it's a scraped proposal
  const repo = await getPartnerSubmissionRepo();
  const existing = await repo.get(c.req.param("id"));
  if (!existing || existing.source !== "scraped") {
    return c.json({ error: "not_found" }, 404);
  }

  const actor = adminActor(c);
  const workflow = await getPartnerWorkflow();
  try {
    const proposal = await workflow.reject(
      c.req.param("id"),
      parsed.reason,
      parsed.adminId ?? actor,
    );

    const audit = await getAuditRepo();
    await audit.append({
      actor,
      action: "admin.proposal.reject",
      targetId: proposal.id,
      targetType: "submission",
      before: { status: "submitted" },
      after: { status: proposal.status },
      notes: `reason: ${parsed.reason}`,
    });

    return c.json({ proposal });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "submission_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});
