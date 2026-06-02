import { clearToken, getToken } from "../../utils/api";
import { installWindowHandlers } from "../../utils/error-reporter";
import { t } from "../../utils/i18n";

installWindowHandlers("extension-popup");

const PREF_SHOW_PANEL = "truerate_show_panel";

const app = document.getElementById("app")!;
document.head.appendChild(stylesheet());

async function getShowPanel(): Promise<boolean> {
  const result = await browser.storage.local.get(PREF_SHOW_PANEL);
  return result[PREF_SHOW_PANEL] !== false;
}

async function setShowPanel(value: boolean): Promise<void> {
  await browser.storage.local.set({ [PREF_SHOW_PANEL]: value });
}

async function render() {
  const [token, showPanel] = await Promise.all([getToken(), getShowPanel()]);
  app.innerHTML = view(!!token, showPanel);
  wire();
}

function view(signedIn: boolean, showPanel: boolean): string {
  const accountSection = signedIn
    ? `<p class="status ok">&#10003; ${t("optionsSignedIn")}</p>
       <button id="signout" class="ghost">${t("optionsSignOutButton")}</button>`
    : `<p class="status">${t("optionsNotSignedIn")}</p>
       <a class="link-btn" href="http://localhost:3000" target="_blank" rel="noopener">${t("optionsSignInLink")}</a>`;

  return `
    <div class="page">
      <h1>${t("optionsTitle")}</h1>

      <section>
        <h2>${t("optionsAccountHeading")}</h2>
        ${accountSection}
      </section>

      <section>
        <h2>${t("optionsPreferencesHeading")}</h2>
        <label class="toggle-row">
          <span>${t("optionsShowPanelLabel")}</span>
          <input type="checkbox" id="show-panel" ${showPanel ? "checked" : ""} />
        </label>
      </section>
    </div>`;
}

function wire() {
  document.getElementById("signout")?.addEventListener("click", async () => {
    await clearToken();
    await render();
  });
  document.getElementById("show-panel")?.addEventListener("change", async (e) => {
    await setShowPanel((e.target as HTMLInputElement).checked);
  });
}

function stylesheet(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f6fb;color:#0b1f3a}
    .page{max-width:480px;margin:0 auto;padding:32px 24px}
    h1{font-size:20px;font-weight:800;margin:0 0 24px}
    h2{font-size:14px;font-weight:700;color:#0b1f3a;margin:0 0 10px}
    section{background:#fff;border:1px solid #e6e6ef;border-radius:12px;padding:16px 20px;margin-bottom:16px}
    .status{font-size:14px;color:#6a6a85;margin:0 0 12px}
    .status.ok{color:#0b8a5a;font-weight:600}
    button,a.link-btn{display:inline-block;padding:9px 18px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
    button.ghost{background:transparent;color:#0b1f3a;border:1px solid #dcdce6}
    a.link-btn{background:#0b1f3a;color:#fff;border:0}
    .toggle-row{display:flex;align-items:center;justify-content:space-between;font-size:14px;gap:12px}
    input[type=checkbox]{width:18px;height:18px;cursor:pointer;flex-shrink:0}`;
  return s;
}

render();
