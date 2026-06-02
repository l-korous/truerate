// Synthetic partner-persona tests for the partner self-service flow (#142).
//
// Covers the full lifecycle driven by two personas:
//   • Alice — org owner (can create, submit, see status)
//   • Bob   — org editor (can also submit; cannot approve/reject)
//   • Admin — system-level actor (can approve/reject)
//
// All repos are in-memory; no live Entra or Cosmos is required.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryPartnerOrgRepo,
  MemoryPartnerSubmissionRepo,
  MemoryPartnerNotificationRepo,
  PartnerWorkflow,
  PartnerWorkflowError,
  assertNoPriceFields,
  type PartnerOrg,
  type PartnerProgramDraft,
} from "../src/partner.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE_ID = "persona-alice-owner";
const BOB_ID = "persona-bob-editor";

const TEST_ORG: PartnerOrg = {
  id: "org-test-hotel-group",
  name: "Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@testhotelgroup.cz",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const VALID_DRAFT: PartnerProgramDraft = {
  name: "Test Hotel Group Loyalty",
  category: "hotel",
  region: "CZ",
  sourceUrl: "https://testhotelgroup.cz/loyalty",
  tiers: ["Silver", "Gold"],
  fields: [
    { key: "membershipNumber", label: "Membership Number", type: "text" },
  ],
  benefits: {
    Silver: [
      {
        scope: "brand",
        match: { brands: ["Test Hotel Group"] },
        value: { kind: "percentDiscount", percentOff: 0.1, conditions: "direct booking only" },
      },
    ],
    Gold: [
      {
        scope: "brand",
        match: { brands: ["Test Hotel Group"] },
        value: { kind: "percentDiscount", percentOff: 0.15, conditions: "direct booking only" },
      },
      {
        scope: "brand",
        match: { brands: ["Test Hotel Group"] },
        value: {
          kind: "perk",
          perks: ["Free breakfast"],
          structuredPerks: [
            { type: "free_breakfast", label: "Complimentary breakfast daily" },
          ],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("partner persona: signup + org association", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
  });

  test("Alice (owner) can be associated with the org", async () => {
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");
    const member = await orgs.getMember(ALICE_ID, TEST_ORG.id);
    assert.ok(member, "member record should exist");
    assert.equal(member.role, "owner");
    assert.equal(member.userId, ALICE_ID);
    assert.equal(member.orgId, TEST_ORG.id);
  });

  test("Bob (editor) can be associated with the org", async () => {
    await workflow.associateUser(BOB_ID, TEST_ORG.id, "editor");
    const member = await orgs.getMember(BOB_ID, TEST_ORG.id);
    assert.ok(member);
    assert.equal(member.role, "editor");
  });

  test("associating with a non-existent org throws org_not_found", async () => {
    await assert.rejects(
      () => workflow.associateUser("user-xyz", "nonexistent-org", "owner"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "org_not_found");
        return true;
      },
    );
  });

  test("org model contains no price/amount fields", async () => {
    const org = await orgs.getOrg(TEST_ORG.id);
    assert.ok(org);
    const raw = JSON.stringify(org);
    assert.ok(!raw.includes("price"), "no price field in org");
    assert.ok(!raw.includes("amount"), "no amount field in org");
    assert.ok(!raw.includes("nightly"), "no nightly field in org");
  });
});

describe("partner persona: create and submit a program", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");
    await workflow.associateUser(BOB_ID, TEST_ORG.id, "editor");
  });

  test("Alice creates a draft submission", async () => {
    const sub = await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-alice-1");
    assert.equal(sub.id, "sub-alice-1");
    assert.equal(sub.status, "draft");
    assert.equal(sub.orgId, TEST_ORG.id);
    assert.equal(sub.submittedByUserId, ALICE_ID);
    assert.equal(sub.programDraft.name, VALID_DRAFT.name);
  });

  test("Bob (editor) can also create a draft", async () => {
    const sub = await workflow.createDraft(BOB_ID, TEST_ORG.id, VALID_DRAFT, "sub-bob-1");
    assert.equal(sub.status, "draft");
    assert.equal(sub.submittedByUserId, BOB_ID);
  });

  test("non-member cannot create a draft (not_a_member)", async () => {
    await assert.rejects(
      () => workflow.createDraft("outsider-id", TEST_ORG.id, VALID_DRAFT, "sub-outsider"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "not_a_member");
        return true;
      },
    );
  });

  test("Alice submits her draft for review", async () => {
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-alice-submit");
    const submitted = await workflow.submitForReview(ALICE_ID, "sub-alice-submit");
    assert.equal(submitted.status, "submitted");
  });

  test("Bob (editor) can submit a draft", async () => {
    await workflow.createDraft(BOB_ID, TEST_ORG.id, VALID_DRAFT, "sub-bob-submit");
    const submitted = await workflow.submitForReview(BOB_ID, "sub-bob-submit");
    assert.equal(submitted.status, "submitted");
  });

  test("non-member cannot submit (not_a_member)", async () => {
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-perm-test");
    await assert.rejects(
      () => workflow.submitForReview("outsider-id", "sub-perm-test"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "not_a_member");
        return true;
      },
    );
  });

  test("submitting again from submitted status throws invalid_transition", async () => {
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-double-submit");
    await workflow.submitForReview(ALICE_ID, "sub-double-submit");
    await assert.rejects(
      () => workflow.submitForReview(ALICE_ID, "sub-double-submit"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "invalid_transition");
        return true;
      },
    );
  });

  test("submission_received notification is sent on submit", async () => {
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-notif-test");
    await workflow.submitForReview(ALICE_ID, "sub-notif-test");
    const notifs = await notifications.listBySubmission("sub-notif-test");
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].event, "submission_received");
    assert.equal(notifs[0].recipientEmail, TEST_ORG.contactEmail);
  });

  test("notification payload contains no price/amount fields", async () => {
    const notifs = await notifications.listByOrg(TEST_ORG.id);
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes("price"), `notification ${n.id} must not contain 'price'`);
      assert.ok(!raw.includes("amount"), `notification ${n.id} must not contain 'amount'`);
      assert.ok(!raw.includes("nightly"), `notification ${n.id} must not contain 'nightly'`);
      assert.ok(!raw.includes("total"), `notification ${n.id} must not contain 'total'`);
    }
  });
});

describe("partner persona: admin approve → publish", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");
    // Alice creates and submits
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-approve-1");
    await workflow.submitForReview(ALICE_ID, "sub-approve-1");
  });

  test("admin can approve a submitted submission", async () => {
    const approved = await workflow.approve("sub-approve-1", "partner-prog-test-hotel-group-v1");
    assert.equal(approved.status, "approved");
    assert.equal(approved.publishedProgramId, "partner-prog-test-hotel-group-v1");
    assert.ok(approved.updatedAt, "updatedAt must be set");
    assert.match(approved.updatedAt, /^\d{4}-\d{2}-\d{2}T/, "updatedAt must be an ISO date");
  });

  test("approved submission is persisted with publishedProgramId", async () => {
    const sub = await submissions.get("sub-approve-1");
    assert.equal(sub?.status, "approved");
    assert.equal(sub?.publishedProgramId, "partner-prog-test-hotel-group-v1");
  });

  test("submission_approved notification is sent on approval", async () => {
    const notifs = await notifications.listBySubmission("sub-approve-1");
    const approvedNotif = notifs.find((n) => n.event === "submission_approved");
    assert.ok(approvedNotif, "submission_approved notification must be sent");
    assert.equal(approvedNotif.recipientEmail, TEST_ORG.contactEmail);
    assert.equal(approvedNotif.payload.publishedProgramId, "partner-prog-test-hotel-group-v1");
  });

  test("notification payload on approve contains no price/amount fields", async () => {
    const notifs = await notifications.listBySubmission("sub-approve-1");
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes('"price"'), `notification must not contain price`);
      assert.ok(!raw.includes('"amount"'), `notification must not contain amount`);
      assert.ok(!raw.includes("nightly"), `notification must not contain nightly`);
      assert.ok(!raw.includes("finalPrice"), `notification must not contain finalPrice`);
      assert.ok(!raw.includes("memberPrice"), `notification must not contain memberPrice`);
    }
  });

  test("approving an already-approved submission throws invalid_transition", async () => {
    await assert.rejects(
      () => workflow.approve("sub-approve-1", "partner-prog-duplicate"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "invalid_transition");
        return true;
      },
    );
  });

  test("approved program draft carries no price/amount/nightly fields", async () => {
    const sub = await submissions.get("sub-approve-1");
    assert.ok(sub);
    const raw = JSON.stringify(sub.programDraft);
    assert.ok(!raw.includes('"price"'), "no price in published draft");
    assert.ok(!raw.includes('"amount"'), "no amount in published draft");
    assert.ok(!raw.includes('"nightly"'), "no nightly in published draft");
    assert.ok(!raw.includes('"total"'), "no total in published draft");
    assert.ok(!raw.includes('"memberPrice"'), "no memberPrice in published draft");
    assert.ok(!raw.includes('"finalPrice"'), "no finalPrice in published draft");
  });
});

describe("partner persona: admin reject", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-reject-1");
    await workflow.submitForReview(ALICE_ID, "sub-reject-1");
  });

  test("admin can reject a submitted submission with a reason", async () => {
    const rejected = await workflow.reject("sub-reject-1", "Benefits description is incomplete.");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectReason, "Benefits description is incomplete.");
    assert.ok(!rejected.publishedProgramId, "no publishedProgramId on rejection");
  });

  test("rejection reason is persisted", async () => {
    const sub = await submissions.get("sub-reject-1");
    assert.equal(sub?.status, "rejected");
    assert.equal(sub?.rejectReason, "Benefits description is incomplete.");
  });

  test("partner sees updated status after rejection", async () => {
    const orgSubs = await submissions.listByOrg(TEST_ORG.id);
    const sub = orgSubs.find((s) => s.id === "sub-reject-1");
    assert.ok(sub);
    assert.equal(sub.status, "rejected");
  });

  test("submission_rejected notification is sent with reason", async () => {
    const notifs = await notifications.listBySubmission("sub-reject-1");
    const rejectedNotif = notifs.find((n) => n.event === "submission_rejected");
    assert.ok(rejectedNotif, "submission_rejected notification must be sent");
    assert.equal(rejectedNotif.payload.rejectReason, "Benefits description is incomplete.");
    assert.ok(!rejectedNotif.payload.publishedProgramId, "no publishedProgramId in reject notification");
  });

  test("rejection notification payload contains no price/amount fields", async () => {
    const notifs = await notifications.listBySubmission("sub-reject-1");
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes("price"), "no price in rejection notification");
      assert.ok(!raw.includes("nightly"), "no nightly in rejection notification");
      assert.ok(!raw.includes("finalPrice"), "no finalPrice in rejection notification");
    }
  });

  test("rejecting an already-rejected submission throws invalid_transition", async () => {
    await assert.rejects(
      () => workflow.reject("sub-reject-1", "second rejection"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "invalid_transition");
        return true;
      },
    );
  });

  test("approving a rejected submission throws invalid_transition", async () => {
    await assert.rejects(
      () => workflow.approve("sub-reject-1", "published-prog"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "invalid_transition");
        return true;
      },
    );
  });
});

describe("partner persona: role/permission enforcement", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");
    await workflow.associateUser(BOB_ID, TEST_ORG.id, "editor");
  });

  test("owner role is correctly stored", async () => {
    const m = await orgs.getMember(ALICE_ID, TEST_ORG.id);
    assert.equal(m?.role, "owner");
  });

  test("editor role is correctly stored", async () => {
    const m = await orgs.getMember(BOB_ID, TEST_ORG.id);
    assert.equal(m?.role, "editor");
  });

  test("user not in org cannot create drafts", async () => {
    await assert.rejects(
      () => workflow.createDraft("complete-stranger", TEST_ORG.id, VALID_DRAFT, "sub-stranger"),
      (err: PartnerWorkflowError) => err.code === "not_a_member",
    );
  });

  test("user not in org cannot submit", async () => {
    // create a submission as Alice first
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, VALID_DRAFT, "sub-perm-submit-test");
    await assert.rejects(
      () => workflow.submitForReview("complete-stranger", "sub-perm-submit-test"),
      (err: PartnerWorkflowError) => err.code === "not_a_member",
    );
  });

  test("editor can draft and submit (same permissions as owner for those actions)", async () => {
    await workflow.createDraft(BOB_ID, TEST_ORG.id, VALID_DRAFT, "sub-editor-flow");
    const submitted = await workflow.submitForReview(BOB_ID, "sub-editor-flow");
    assert.equal(submitted.status, "submitted");
  });

  test("listMembers returns all org members", async () => {
    const members = await orgs.listMembers(TEST_ORG.id);
    assert.ok(members.some((m) => m.userId === ALICE_ID && m.role === "owner"));
    assert.ok(members.some((m) => m.userId === BOB_ID && m.role === "editor"));
  });
});

describe("partner persona: price-field guard (product rule #1)", () => {
  test("assertNoPriceFields passes clean draft", () => {
    assert.doesNotThrow(() => assertNoPriceFields(VALID_DRAFT));
  });

  test("assertNoPriceFields throws on 'price' key", () => {
    assert.throws(
      () => assertNoPriceFields({ name: "Test", price: 99 }),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "price_field_in_draft");
        return true;
      },
    );
  });

  test("assertNoPriceFields throws on 'nightly' key", () => {
    assert.throws(
      () => assertNoPriceFields({ benefits: { Silver: [{ nightly: 80 }] } }),
      (err: PartnerWorkflowError) => err.code === "price_field_in_draft",
    );
  });

  test("assertNoPriceFields throws on 'totalAmount' key", () => {
    assert.throws(
      () => assertNoPriceFields({ totalAmount: 200 }),
      (err: PartnerWorkflowError) => err.code === "price_field_in_draft",
    );
  });

  test("assertNoPriceFields throws on nested 'finalPrice'", () => {
    assert.throws(
      () => assertNoPriceFields({ offer: { finalPrice: 150 } }),
      (err: PartnerWorkflowError) => err.code === "price_field_in_draft",
    );
  });

  test("creating a draft with a price field throws price_field_in_draft", async () => {
    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    const workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");

    const badDraft = { ...VALID_DRAFT, price: 99 } as unknown as PartnerProgramDraft;
    await assert.rejects(
      () => workflow.createDraft(ALICE_ID, TEST_ORG.id, badDraft, "sub-price-guard"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "price_field_in_draft");
        return true;
      },
    );
  });

  test("approving a submission whose draft has a price field throws price_field_in_draft", async () => {
    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    const workflow = new PartnerWorkflow(orgs, submissions, notifications);
    await orgs.createOrg(TEST_ORG);
    await workflow.associateUser(ALICE_ID, TEST_ORG.id, "owner");

    // Bypass the guard at create time by injecting directly
    const badDraft = { ...VALID_DRAFT } as unknown as PartnerProgramDraft;
    await workflow.createDraft(ALICE_ID, TEST_ORG.id, badDraft, "sub-bad-at-approve");
    await workflow.submitForReview(ALICE_ID, "sub-bad-at-approve");

    // Tamper the stored submission with a price field
    const stored = await submissions.get("sub-bad-at-approve");
    assert.ok(stored);
    (stored.programDraft as unknown as Record<string, unknown>).nightlyRate = 120;
    await submissions.update(stored);

    await assert.rejects(
      () => workflow.approve("sub-bad-at-approve", "prog-tampered"),
      (err: PartnerWorkflowError) => {
        assert.equal(err.code, "price_field_in_draft");
        return true;
      },
    );
  });
});

describe("partner persona: full lifecycle (signup → submit → approve → catalog)", () => {
  let orgs: MemoryPartnerOrgRepo;
  let submissions: MemoryPartnerSubmissionRepo;
  let notifications: MemoryPartnerNotificationRepo;
  let workflow: PartnerWorkflow;

  before(async () => {
    orgs = new MemoryPartnerOrgRepo();
    submissions = new MemoryPartnerSubmissionRepo();
    notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();
    workflow = new PartnerWorkflow(orgs, submissions, notifications);
  });

  test("full lifecycle: org created, user onboarded, draft created, submitted, approved, published", async () => {
    // 1. Org signup
    const org: PartnerOrg = {
      id: "org-full-lifecycle",
      name: "Full Lifecycle Hotel",
      country: "CZ",
      contactEmail: "lifecycle@hotel.cz",
      status: "active",
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);

    // 2. Partner user association
    const ownerId = "lifecycle-owner-user";
    await workflow.associateUser(ownerId, org.id, "owner");
    const member = await orgs.getMember(ownerId, org.id);
    assert.equal(member?.role, "owner");

    // 3. Create draft
    const sub = await workflow.createDraft(ownerId, org.id, VALID_DRAFT, "sub-lifecycle-1");
    assert.equal(sub.status, "draft");

    // 4. Submit for review
    const submitted = await workflow.submitForReview(ownerId, sub.id);
    assert.equal(submitted.status, "submitted");

    // 5. Admin approves and publishes
    const publishedId = "partner-prog-full-lifecycle-v1";
    const approved = await workflow.approve(sub.id, publishedId);
    assert.equal(approved.status, "approved");
    assert.equal(approved.publishedProgramId, publishedId);

    // 6. Verify notifications: received + approved
    const notifs = await notifications.listBySubmission(sub.id);
    assert.equal(notifs.length, 2);
    assert.ok(notifs.some((n) => n.event === "submission_received"));
    assert.ok(notifs.some((n) => n.event === "submission_approved"));

    // 7. Published program has no price fields
    const stored = await submissions.get(sub.id);
    assert.ok(stored);
    const catalogPayload = JSON.stringify(stored.programDraft);
    assert.ok(!catalogPayload.includes("price"), "catalog draft: no price");
    assert.ok(!catalogPayload.includes("amount"), "catalog draft: no amount");
    assert.ok(!catalogPayload.includes("nightly"), "catalog draft: no nightly");
    assert.ok(!catalogPayload.includes("memberPrice"), "catalog draft: no memberPrice");
    assert.ok(!catalogPayload.includes("finalPrice"), "catalog draft: no finalPrice");

    // 8. All notifications are price-free
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes("price"), `notification ${n.event}: no price`);
      assert.ok(!raw.includes("amount"), `notification ${n.event}: no amount`);
      assert.ok(!raw.includes("nightly"), `notification ${n.event}: no nightly`);
    }
  });

  test("full lifecycle: submit → reject flow", async () => {
    const org: PartnerOrg = {
      id: "org-reject-lifecycle",
      name: "Rejected Hotel",
      country: "DE",
      contactEmail: "partner@rejectedhotel.de",
      status: "active",
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    const userId = "reject-lifecycle-user";
    await workflow.associateUser(userId, org.id, "owner");
    await workflow.createDraft(userId, org.id, VALID_DRAFT, "sub-reject-lifecycle");
    await workflow.submitForReview(userId, "sub-reject-lifecycle");
    const rejected = await workflow.reject("sub-reject-lifecycle", "Incomplete source URL");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectReason, "Incomplete source URL");

    const notifs = await notifications.listBySubmission("sub-reject-lifecycle");
    assert.ok(notifs.some((n) => n.event === "submission_rejected"), "rejection notification sent");

    // Partner can see their rejected submission
    const orgSubs = await submissions.listByOrg(org.id);
    const found = orgSubs.find((s) => s.id === "sub-reject-lifecycle");
    assert.equal(found?.status, "rejected");
  });
});
