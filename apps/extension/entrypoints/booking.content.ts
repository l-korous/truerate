import type { PageContext, PageMatchResult } from "@truerate/core";
import { sendTrMessage } from "../utils/messages";

// Content script for Booking.com.
//
// It builds a PageContext from what's on screen and asks the background worker
// to match the user's benefits against it:
//   - on a hotel detail page (/hotel/*): read the property name + visible
//     PUBLIC price (no login needed) so we can show an indicative member price;
//   - on a results page (/searchresults*): send the domain only, so we can show
//     which benefits are active on this site and which perks the user holds.
// We never rewrite Booking's own prices; we surface our value in a self-
// contained Shadow-DOM panel. Selectors are best-effort and will need
// maintenance as Booking's markup changes (kept here, isolated, on purpose).

export default defineContentScript({
  matches: ["https://*.booking.com/searchresults*", "https://*.booking.com/hotel/*"],
  runAt: "document_idle",
  async main() {
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

  const { nightly, currency } = readPrice();
  return {
    domain,
    property: name
      ? { name, publicNightly: nightly ?? undefined, currency: currency ?? undefined }
      : undefined,
  };
}

// Best-effort: pull a visible price + currency off the page.
function readPrice(): { nightly: number | null; currency: string | null } {
  const el =
    document.querySelector('[data-testid="price-and-discounted-price"]') ||
    document.querySelector('.prco-valign-middle-helper') ||
    document.querySelector('[data-testid="price-for-x-nights"]');
  const text = el?.textContent ?? "";
  const num = text.replace(/[^0-9.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const nightly = num ? Number(num) : null;
  const currency =
    /€|EUR/.test(text) ? "EUR" : /Kč|CZK/.test(text) ? "CZK" : /\$|USD/.test(text) ? "USD" : null;
  return { nightly: Number.isFinite(nightly) ? nightly : null, currency };
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

  const price =
    r.indicativeOffer && r.publicOffer
      ? `<div class="tr-price-row">
           <span class="tr-public">${money(r.publicOffer.totalAmount, r.publicOffer.currency)}</span>
           <span class="tr-member">${money(r.indicativeOffer.totalAmount, r.indicativeOffer.currency)} <em>est.</em></span>
         </div>`
      : "";

  const perks = r.perks.length
    ? `<div class="tr-perks">${r.perks.map(esc).map((p) => `<span>${p}</span>`).join("")}</div>`
    : "";

  const active = r.matches.length
    ? `<p class="tr-active">Active here: ${[...new Set(r.matches.map((m) => esc(m.membershipLabel)))].join(", ")}</p>`
    : "";

  panel(s).innerHTML = head(true) + `<div class="tr-body">
      ${price}
      ${perks}
      ${active}
      <p class="tr-foot">Member price is an estimate from your declared benefit. Perks are exact.</p>
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
function money(n: number, c: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n)} ${c}`; }
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
    .tr-price-row{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
    .tr-public{color:#8a8aa0;text-decoration:line-through}
    .tr-member{font-weight:700;color:#0f8a5f}
    .tr-member em{font-style:normal;font-size:10px;color:#0f8a5f;opacity:.8}
    .tr-perks{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
    .tr-perks span{background:#fdf3df;color:#8a5b12;font-size:11px;padding:3px 8px;border-radius:999px}
    .tr-active{font-size:12px;color:#0c1b2e;margin:6px 0 0}
    .tr-muted{color:#8a8aa0;font-size:13px;margin:0}
    .tr-foot{color:#a0a0b5;font-size:10px;margin:10px 0 0}
    .tr-btn{display:inline-block;margin-top:8px;background:#0c1b2e;color:#fff;text-decoration:none;padding:8px 14px;border-radius:9px;font-size:13px;font-weight:600}`;
  return s;
}
