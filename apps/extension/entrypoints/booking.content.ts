import type { PageContext, PageMatchResult } from "@truerate/core";
import { detectPageType, extractHotelName } from "../utils/booking-context";
import { sendTrMessage } from "../utils/messages";
import { installWindowHandlers } from "../utils/error-reporter";
import { esc, perkEstimateRow } from "../utils/render-helpers";
import { t } from "../utils/i18n";

// Content script for Booking.com.
//
// Handles both search-results and property-detail pages, plus Booking's SPA
// navigation (URL changes without full page reload). No member prices are
// computed (per product rule #1).

export default defineContentScript({
  matches: ["https://*.booking.com/searchresults*", "https://*.booking.com/hotel/*"],
  runAt: "document_idle",
  async main() {
    installWindowHandlers("extension-content");
    await runPanel();
    observeNavigation(() => runPanel());
  },
});

// --- SPA navigation ----------------------------------------------------------

// Intercept pushState/replaceState and listen to popstate so we re-render the
// panel whenever Booking's SPA transitions between pages.
function observeNavigation(onNavigate: () => void): void {
  let lastHref = location.href;

  const check = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
  };

  for (const method of ["pushState", "replaceState"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = history[method].bind(history) as (...a: any[]) => void;
    history[method] = function (this: History, ...args: Parameters<(typeof history)[typeof method]>) {
      original(...args);
      check();
    };
  }
  window.addEventListener("popstate", check);
}

// --- Panel lifecycle ---------------------------------------------------------

async function runPanel(): Promise<void> {
  const pageType = detectPageType(location.href);
  if (pageType === "unknown") {
    document.getElementById("truerate-root")?.remove();
    return;
  }

  const shadow = mountHost();
  const status = await sendTrMessage({ type: "TR_AUTH_STATUS" });
  if (!status.signedIn) return renderSignedOut(shadow);

  renderLoading(shadow);
  const context = await buildContext(pageType);
  const resp = await sendTrMessage({ type: "TR_MATCH", context });
  if (!resp.ok) return renderError(shadow, resp.error ?? "Could not load benefits");
  renderResult(shadow, resp.result);
}

// --- Context builder ---------------------------------------------------------

async function buildContext(pageType: "search" | "detail"): Promise<PageContext> {
  const domain = "booking.com";
  if (pageType !== "detail") return { domain };
  const name = await waitForHotelName();
  return { domain, property: name ? { name } : undefined };
}

function waitForHotelName(timeout = 3000): Promise<string | undefined> {
  const immediate = extractHotelName(document);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      observer.disconnect();
      resolve(extractHotelName(document));
    }, timeout);

    const observer = new MutationObserver(() => {
      const name = extractHotelName(document);
      if (name) {
        clearTimeout(deadline);
        observer.disconnect();
        resolve(name);
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
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
  panel(s).innerHTML = head() + `<div class="tr-body"><p>${t("panelSignInPrompt")}</p>
    <a class="tr-btn" href="http://localhost:3000" target="_blank" rel="noopener">${t("panelOpenTrueRate")}</a></div>`;
}
function renderLoading(s: ShadowRoot) {
  panel(s).innerHTML = head() + `<div class="tr-body"><p class="tr-muted">${t("panelLoading")}</p></div>`;
}
function renderError(s: ShadowRoot, msg: string) {
  panel(s).innerHTML = head() + `<div class="tr-body"><p class="tr-muted">${esc(msg)}</p></div>`;
}

function renderResult(s: ShadowRoot, r: PageMatchResult) {
  if (!r.matches.length && !r.perks.length) {
    panel(s).innerHTML = head(true) + `<div class="tr-body"><p class="tr-muted">${t("panelNoBenefits")}</p></div>`;
    wireClose(s);
    return;
  }

  const discounts = r.matches
    .filter((m) => m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff)
    .map((m) => {
      const pct = `${Math.round((m.benefit.value.percentOff ?? 0) * 100)}% off`;
      const cond = m.benefit.value.conditions ? ` <span class="tr-cond">(${esc(m.benefit.value.conditions)})</span>` : "";
      return `<span>${pct} — ${esc(m.membershipLabel)}${cond}</span>`;
    });

  const discountHtml = discounts.length
    ? `<div class="tr-discounts">${discounts.join("")}</div>`
    : "";

  // Free-text perks (from benefits without structuredPerks, or as fallback)
  const estimatedPerkTypes = new Set(r.perkEstimates.map((e) => e.label));
  const freeTextPerks = r.perks.filter((p) => !estimatedPerkTypes.has(p));
  const perksHtml = freeTextPerks.length
    ? `<div class="tr-perks">${freeTextPerks.map(esc).map((p) => `<span>${p}</span>`).join("")}</div>`
    : "";

  const estimatesHtml = r.perkEstimates.length
    ? `<div class="tr-estimates">
        <p class="tr-est-head">${t("panelPerkEstimatesHeader")} <span class="tr-est-note">${t("panelPerkEstimatesNote")}</span></p>
        ${r.perkEstimates.map((e) => perkEstimateRow(e)).join("")}
      </div>`
    : "";

  const active = r.matches.length
    ? `<p class="tr-active">${t("panelActivePrefix")} ${[...new Set(r.matches.map((m) => esc(m.membershipLabel)))].join(", ")}</p>`
    : "";

  const hasStale = r.matches.some((m) => m.confidence?.level === "stale" || m.confidence?.isExpired);
  const hasLow = r.matches.some((m) => m.confidence?.level === "low");
  const stalenessHtml =
    hasStale || hasLow
      ? `<div class="tr-stale">${esc(t(hasStale ? "panelStalenessNote" : "panelLowConfidenceNote"))}</div>`
      : "";

  panel(s).innerHTML = head(true) + `<div class="tr-body">
      ${discountHtml}
      ${perksHtml}
      ${estimatesHtml}
      ${stalenessHtml}
      ${active}
      <p class="tr-foot">${t("panelDisclaimer")}</p>
    </div>`;
  wireClose(s);
}

function head(closable = false): string {
  return `<div class="tr-head"><span class="tr-logo">TrueRate</span>
    ${closable ? `<button class="tr-close" aria-label="${t("panelCloseAriaLabel")}">×</button>` : ""}</div>`;
}
function wireClose(s: ShadowRoot) {
  s.querySelector(".tr-close")?.addEventListener("click", () => document.getElementById("truerate-root")?.remove());
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
    .tr-btn{display:inline-block;margin-top:8px;background:#0c1b2e;color:#fff;text-decoration:none;padding:8px 14px;border-radius:9px;font-size:13px;font-weight:600}
    .tr-cond{font-weight:400;font-size:10px;opacity:.75}
    .tr-estimates{margin:8px 0 4px;border-top:1px solid #eeeef5;padding-top:8px}
    .tr-est-head{font-size:11px;font-weight:600;color:#0c1b2e;margin:0 0 6px}
    .tr-est-note{font-weight:400;color:#8a8aa0}
    .tr-est-row{margin-bottom:6px}
    .tr-est-label{display:block;font-size:11px;color:#0c1b2e;font-weight:600}
    .tr-est-value{display:block;font-size:11px;color:#0f8a5f;font-weight:500}
    .tr-est-cond{display:block;font-size:10px;color:#8a8aa0}
    .tr-stale{background:#fff8e6;border:1px solid #f5c842;border-radius:8px;padding:6px 10px;margin:6px 0;font-size:11px;color:#8a6a00}`;
  return s;
}
