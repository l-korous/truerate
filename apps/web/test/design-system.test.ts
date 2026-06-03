import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../tailwind.config";

// ── Token completeness ───────────────────────────────────────────────────────

test("tailwind config: ink tokens present", () => {
  const { ink } = colors;
  assert.ok(ink.DEFAULT, "ink.DEFAULT required");
  assert.ok(ink.soft, "ink.soft required");
  assert.ok(ink.muted, "ink.muted required");
});

test("tailwind config: save tokens present with dark variant", () => {
  const { save } = colors;
  assert.ok(save.DEFAULT, "save.DEFAULT required");
  assert.ok(save.soft, "save.soft required");
  assert.ok(save.dark, "save.dark required for accessible text on light green backgrounds");
});

test("tailwind config: points tokens present with soft and dark variants", () => {
  const { points } = colors;
  assert.ok(points.DEFAULT, "points.DEFAULT required");
  assert.ok(points.soft, "points.soft required — used in StatusBadge unverified state");
  assert.ok(points.dark, "points.dark required for accessible text on light amber backgrounds");
});

test("tailwind config: paper and card tokens present", () => {
  assert.ok(colors.paper, "paper token required");
  assert.ok(colors.card, "card token required");
  assert.ok(colors.line, "line token required");
});

// ── Color contrast (relative luminance) ─────────────────────────────────────

function toLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3.0;

const colors = config.theme.extend.colors;

test("color contrast: save.dark on save.soft meets WCAG AA for normal text", () => {
  const saveDark = colors.save.dark;
  const saveSoft = colors.save.soft;
  const ratio = contrast(saveDark, saveSoft);
  assert.ok(
    ratio >= WCAG_AA_NORMAL,
    `save.dark (${saveDark}) on save.soft (${saveSoft}) has contrast ${ratio.toFixed(2)}:1 — needs ${WCAG_AA_NORMAL}:1`,
  );
});

test("color contrast: points.dark on points.soft meets WCAG AA for normal text", () => {
  const pointsDark = colors.points.dark;
  const pointsSoft = colors.points.soft;
  const ratio = contrast(pointsDark, pointsSoft);
  assert.ok(
    ratio >= WCAG_AA_NORMAL,
    `points.dark (${pointsDark}) on points.soft (${pointsSoft}) has contrast ${ratio.toFixed(2)}:1 — needs ${WCAG_AA_NORMAL}:1`,
  );
});

test("color contrast: ink.DEFAULT on paper meets WCAG AA for normal text", () => {
  const ink = colors.ink.DEFAULT;
  const paper = colors.paper;
  const ratio = contrast(ink, paper);
  assert.ok(
    ratio >= WCAG_AA_NORMAL,
    `ink (${ink}) on paper (${paper}) has contrast ${ratio.toFixed(2)}:1 — needs ${WCAG_AA_NORMAL}:1`,
  );
});

test("color contrast: ink.muted on paper meets WCAG AA for normal text", () => {
  const inkMuted = colors.ink.muted;
  const paper = colors.paper;
  const ratio = contrast(inkMuted, paper);
  assert.ok(
    ratio >= WCAG_AA_NORMAL,
    `ink.muted (${inkMuted}) on paper (${paper}) has contrast ${ratio.toFixed(2)}:1 — needs ${WCAG_AA_NORMAL}:1`,
  );
});

test("color contrast: save.DEFAULT on save.soft meets WCAG AA for large text only", () => {
  const saveDefault = colors.save.DEFAULT;
  const saveSoft = colors.save.soft;
  const ratio = contrast(saveDefault, saveSoft);
  // save.DEFAULT is used for icons/dots/backgrounds, not small text — large-text threshold sufficient
  assert.ok(
    ratio >= WCAG_AA_LARGE,
    `save.DEFAULT (${saveDefault}) on save.soft (${saveSoft}) has contrast ${ratio.toFixed(2)}:1 — needs ${WCAG_AA_LARGE}:1 (large text)`,
  );
});

// ── Font family tokens ────────────────────────────────────────────────────────

test("tailwind config: display and sans font families defined", () => {
  const { fontFamily } = config.theme.extend;
  assert.ok(Array.isArray(fontFamily.display) && fontFamily.display.length > 0, "display font family required");
  assert.ok(Array.isArray(fontFamily.sans) && fontFamily.sans.length > 0, "sans font family required");
});

// ── Custom border radius ──────────────────────────────────────────────────────

test("tailwind config: xl2 border radius token defined", () => {
  const { borderRadius } = config.theme.extend;
  assert.ok(borderRadius.xl2, "borderRadius.xl2 required for rounded-xl2 utility");
});
