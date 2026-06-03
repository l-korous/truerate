import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePhase,
  buildSetupSteps,
  buildGenericSetupNote,
} from "../components/OnboardingMcpStep";

// ── derivePhase ───────────────────────────────────────────────────────────────

test("derivePhase: returns loading when loading=true", () => {
  assert.equal(derivePhase(null, null, true), "loading");
});

test("derivePhase: returns loading when status is null and not loading", () => {
  assert.equal(derivePhase(null, null, false), "loading");
});

test("derivePhase: returns issued when issuedUrl is present", () => {
  const status = { active: true as const, createdAt: "2025-01-01T00:00:00Z" };
  assert.equal(derivePhase(status, "https://example.com/u/tok/mcp", false), "issued");
});

test("derivePhase: returns active-hidden when status is active but no issuedUrl", () => {
  const status = { active: true as const, createdAt: "2025-01-01T00:00:00Z" };
  assert.equal(derivePhase(status, null, false), "active-hidden");
});

test("derivePhase: returns no-url when status is not active and no issuedUrl", () => {
  const status = { active: false as const };
  assert.equal(derivePhase(status, null, false), "no-url");
});

test("derivePhase: loading takes priority over issued url", () => {
  const status = { active: true as const, createdAt: "2025-01-01T00:00:00Z" };
  assert.equal(derivePhase(status, "https://example.com/u/tok/mcp", true), "loading");
});

// ── buildSetupSteps ───────────────────────────────────────────────────────────

test("buildSetupSteps: returns 5 steps", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  assert.equal(steps.length, 5);
});

test("buildSetupSteps: each step has a title and detail", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  for (const step of steps) {
    assert.ok(step.title && step.title.length > 0, "step must have a title");
    assert.ok(step.detail && step.detail.length > 0, "step must have a detail");
  }
});

test("buildSetupSteps: step detail mentions the user's URL", () => {
  const url = "https://mcp.truerate.app/u/my-token/mcp";
  const steps = buildSetupSteps(url);
  const hasUrl = steps.some((s) => s.detail.includes(url));
  assert.ok(hasUrl, "at least one step detail must mention the user's URL");
});

test("buildSetupSteps: no step mentions prices", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  for (const step of steps) {
    assert.ok(
      !step.title.toLowerCase().includes("price"),
      `step title must not mention price: "${step.title}"`,
    );
    assert.ok(
      !step.detail.toLowerCase().includes("price"),
      `step detail must not mention price: "${step.detail}"`,
    );
  }
});

test("buildSetupSteps: last step explains what TrueRate provides (perks/discounts, no price word)", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  const last = steps[steps.length - 1];
  assert.ok(
    last.detail.toLowerCase().includes("perk") ||
      last.detail.toLowerCase().includes("discount"),
    "last step should mention perks or discounts",
  );
  assert.ok(
    !last.detail.toLowerCase().includes("price"),
    "last step must not use the word price (TrueRate never handles prices)",
  );
});

test("buildSetupSteps: step 2 mentions the config file path", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  const configStep = steps[1];
  assert.ok(
    configStep.detail.includes("claude_desktop_config.json"),
    "step 2 should reference the config file name",
  );
});

test("buildSetupSteps: step 4 mentions restarting Claude", () => {
  const steps = buildSetupSteps("https://mcp.truerate.app/u/abc/mcp");
  const restartStep = steps[3];
  assert.ok(
    restartStep.detail.toLowerCase().includes("restart") ||
      restartStep.detail.toLowerCase().includes("reopen"),
    "step 4 should mention restarting",
  );
});

// ── buildGenericSetupNote ─────────────────────────────────────────────────────

test("buildGenericSetupNote: includes the user's URL", () => {
  const url = "https://mcp.truerate.app/u/my-token/mcp";
  const note = buildGenericSetupNote(url);
  assert.ok(note.includes(url), "note must include the user's URL");
});

test("buildGenericSetupNote: mentions MCP client alternatives", () => {
  const note = buildGenericSetupNote("https://mcp.truerate.app/u/abc/mcp");
  assert.ok(
    note.includes("Cursor") || note.includes("MCP"),
    "note must mention alternative MCP clients or MCP",
  );
});

test("buildGenericSetupNote: does not mention prices", () => {
  const note = buildGenericSetupNote("https://mcp.truerate.app/u/abc/mcp");
  assert.ok(
    !note.toLowerCase().includes("price"),
    "note must not mention prices",
  );
});

test("buildGenericSetupNote: different URLs produce different notes", () => {
  const n1 = buildGenericSetupNote("https://mcp.truerate.app/u/token1/mcp");
  const n2 = buildGenericSetupNote("https://mcp.truerate.app/u/token2/mcp");
  assert.notEqual(n1, n2);
});
