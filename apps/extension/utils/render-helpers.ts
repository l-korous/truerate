import type { MatchedBenefit, MatchedPerkEstimate } from "@truerate/core";

/** Escape HTML special characters to prevent XSS in innerHTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Determine the worst staleness level across a set of matched benefits.
 *
 * Returns:
 *   "stale"  — at least one benefit's catalog entry has passed its TTL
 *   "low"    — at least one benefit is low-confidence (no stale entries)
 *   null     — all entries are medium/high confidence or confidence is unknown
 *
 * Terms-freshness only; never related to prices.
 */
export function worstStalenessLevel(matches: MatchedBenefit[]): "stale" | "low" | null {
  let hasLow = false;
  for (const m of matches) {
    const level = m.confidence?.level;
    if (level === "stale" || m.confidence?.isExpired) return "stale";
    if (level === "low") hasLow = true;
  }
  return hasLow ? "low" : null;
}

/**
 * Render a single perk estimate row as an HTML string.
 *
 * Shows the perk label, estimated USD value across 3★/4★/5★ hotel bands,
 * and any qualifying conditions. isEstimate:true is always asserted upstream.
 * No price is computed — these are illustrative estimates only.
 */
export function perkEstimateRow(e: MatchedPerkEstimate): string {
  const bands = `~$${e.estimatedUsd[3]} (3★) / $${e.estimatedUsd[4]} (4★) / $${e.estimatedUsd[5]} (5★)`;
  const condNote = e.conditions?.subjectToAvailability ? "subject to availability" : "";
  const channelNote = e.conditions?.bookingChannel?.length
    ? `${e.conditions.bookingChannel.join("/")} booking`
    : "";
  const condStr = [condNote, channelNote].filter(Boolean).join(" · ");
  return `<div class="tr-est-row">
    <span class="tr-est-label">${esc(e.label)}</span>
    <span class="tr-est-value">${bands}</span>
    ${condStr ? `<span class="tr-est-cond">${esc(condStr)}</span>` : ""}
  </div>`;
}
