import type { PageContext, PageMatchResult } from "@truerate/core";
import { sendTrMessage } from "../utils/messages";
import { installWindowHandlers } from "../utils/error-reporter";

// Content script for Booking.com.
//
// Builds a PageContext from what's on screen and asks the background worker to
// match the user's benefits against it. Returns the applicable discount % and
// perks — no member prices are computed (per product rule #1).
// We surface our value in a self-contained Shadow-DOM panel. Selectors are
// best-effort and will need maintenance as Booking's markup changes.

export default defineContentScript({
  matches: ["https://*.booking.com/searchresults*", "https://*.booking.com/hotel/*"],
  runAt: "document_idle",
  async main() {
    installWindowHandlers("extension-content");
    const context = buildContext();
    const status = await sendTrMessage({ type: "TR_AUTH_STATUS" });
    const shadow = mountHost();
    if (!status.signedIn) return renderSignedOut(shadow);

    renderLoading(shadow);
    const resp = await sendTrMessage({ type: "TR_MATCH", context });
    if (!resp.ok) return renderError(shadow, resp.error ?? "Could not load benefits");
    renderResult(shadow, resp.result);
  },
});

// --- Build context from the page --------------------------------------------

function buildContext(): PageContext {
  const domain = "booking.com";
  if (!location.pathname.startsWith("/hotel/")) return { domain };

  const name =
    document.querySelector("h2.pp-header__title")?.textContent?.trim() ||
    document.querySelector('[data-testid="title"]')?.textContent?.trim() ||
    document.title.split(" - ")[0]?.trim();

  return {
    domain,
    property: name ? { name } : undefined,
  };
}

// --- UI (Shadow DOM) ---------------------------------------------------------

function mountHost(): ShadowRoot {
  document.getElementById("truerate-root")?.remove();
  const root = document.createElement("div");
  root.id = "truerate-root";
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });
  shadow.appendChild(styleEl());
  const panel = document.createElement("div");
  panel.className = "tr-panel";
  shadow.appendChild(panel);
  return shadow;
}
const panel = (s: ShadowRoot) => s.querySelector(".tr-panel") as HTMLElement;

function renderSignedOut(s: ShadowRoot) {
  panel(s).innerHTML = head() + `<div class="tr-body"><p>Sign in to see the benefits you hold here.</p>
    <a class="tr-btn" href="http://localhost:3000" target="_blank" rel="noopener">Open TrueRate</a></div>`;
}
function renderLoading(s: ShadowRoot) {
  panel(s).innerHTML = head() + `<div class="tr-body"><p class="tr-muted">Checking your benefits…</p></div>`;
}
function renderError(s: ShadowRoot, msg: string) {
  panel(s).innerHTML = head() + `<div class="tr-body"><p class="tr-muted">${esc(msg)}</p></div>`;
}

function renderResult(s: ShadowRoot, r: PageMatchResult) {
  if (!r.matches.length && !r.perks.length) {
    panel(s).innerHTML = head(true) + `<div class="tr-body"><p class="tr-muted">No benefits on file for this site yet.</p></div>`;
    wireClose(s);
    return;
  }

  const discounts = r.matches
    .filter((m) => m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff)
    .map((m) => `${Math.round((m.benefit.value.percentOff ?? 0) * 100)}% off — ${esc(m.membershipLabel)}`);

  const discountHtml = discounts.length
    ? `<div class="tr-discounts">${discounts.map((d) => `<span>${d}</span>`).join("")}</div>`
    : "";

  const perks = r.perks.length
    ? `<div class="tr-perks">${r.perks.map(esc).map((p) => `<span>${p}</span>`).join("")}</div>`
    : "";

  const active = r.matches.length
    ? `<p class="tr-active">Active here: ${[...new Set(r.matches.map((m) => esc(m.membershipLabel)))].join(", ")}</p>`
    : "";

  panel(s).innerHTML = head(true) + `<div class="tr-body">
      ${discountHtml}
      ${perks}
      ${active}
      <p class="tr-foot">Discounts are from your declared benefits. Apply them to the price you see.</p>
    </div>`;
  wireClose(s);
}

function head(closable = false): string {
  return `<div class="tr-head"><span class="tr-logo">TrueRate</span>
    ${closable ? '<button class="tr-close" aria-label="Close">×</button>' : ""}</div>`;
}
function wireClose(s: ShadowRoot) {
  s.querySelector(".tr-close")?.addEventListener("click", () => document.getElementById("truerate-root")?.remove());
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function styleEl(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    .tr-panel{position:fixed;right:20px;bottom:20px;width:300px;z-index:2147483647;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#0c1b2e;
      border:1px solid #e6e6ef;border-radius:14px;box-shadow:0 12px 40px rgba(20,20,50,.18);overflow:hidden}
    .tr-head{display:flex;align-items:center;padding:12px 14px;background:#0c1b2e;color:#fff}
    .tr-logo{font-weight:700}
    .tr-close{margin-left:auto;background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1}
    .tr-body{padding:12px 14px}
    .tr-discounts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
    .tr-discounts span{background:#e6f4ee;color:#0f8a5f;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px}
    .tr-perks{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
    .tr-perks span{background:#fdf3df;color:#8a5b12;font-size:11px;padding:3px 8px;border-radius:999px}
    .tr-active{font-size:12px;color:#0c1b2e;margin:6px 0 0}
    .tr-muted{color:#8a8aa0;font-size:13px;margin:0}
    .tr-foot{color:#a0a0b5;font-size:10px;margin:10px 0 0}
    .tr-btn{display:inline-block;margin-top:8px;background:#0c1b2e;color:#fff;text-decoration:none;padding:8px 14px;border-radius:9px;font-size:13px;font-weight:600}`;
  return s;
}
