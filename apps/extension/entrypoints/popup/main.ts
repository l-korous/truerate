import { clearToken, getToken, login } from "../../utils/api";

const app = document.getElementById("app")!;
document.head.appendChild(stylesheet());

async function render() {
  const token = await getToken();
  app.innerHTML = token ? signedInView() : signInView();
  wire();
}

function signInView(): string {
  return `
    <div class="card">
      <div class="logo">TrueRate</div>
      <p class="sub">Sign in to surface your member rates on Booking.com.</p>
      <input id="email" type="email" placeholder="Email" autocomplete="username" />
      <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
      <button id="signin">Sign in</button>
      <p id="err" class="err"></p>
    </div>`;
}

function signedInView(): string {
  return `
    <div class="card">
      <div class="logo">TrueRate</div>
      <p class="sub ok">Connected. Open a Booking.com search to see your rates.</p>
      <button id="signout" class="ghost">Sign out</button>
    </div>`;
}

function wire() {
  document.getElementById("signin")?.addEventListener("click", async () => {
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const err = document.getElementById("err")!;
    err.textContent = "";
    try {
      await login(email, password);
      await render();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });
  document.getElementById("signout")?.addEventListener("click", async () => {
    await clearToken();
    await render();
  });
}

function stylesheet(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    body{margin:0;width:300px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f6fb}
    .card{padding:18px}
    .logo{font-weight:800;font-size:18px;color:#0b1f3a}
    .sub{font-size:13px;color:#6a6a85;margin:6px 0 14px}
    .sub.ok{color:#0b8a5a}
    input{width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;border:1px solid #dcdce6;border-radius:9px;font-size:13px}
    button{width:100%;padding:10px;border:0;border-radius:9px;background:#0b1f3a;color:#fff;font-weight:600;font-size:13px;cursor:pointer}
    button.ghost{background:transparent;color:#0b1f3a;border:1px solid #dcdce6}
    .err{color:#c0392b;font-size:12px;min-height:14px;margin:8px 0 0}`;
  return s;
}

render();
