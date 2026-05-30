import type { PageContext, PageMatchResult } from "@truerate/core";

declare const __API_BASE__: string;
export const API_BASE = __API_BASE__;

const TOKEN_KEY = "truerate_token";

export async function getToken(): Promise<string | null> {
  const r = await browser.storage.local.get(TOKEN_KEY);
  return (r[TOKEN_KEY] as string) ?? null;
}
export async function setToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token });
}
export async function clearToken(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Login failed");
  const { token } = (await res.json()) as { token: string };
  await setToken(token);
  return token;
}

/** Match the user's benefits against the page the extension is looking at. */
export async function matchPage(context: PageContext): Promise<PageMatchResult> {
  const token = await getToken();
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${API_BASE}/benefits/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(context),
  });
  if (!res.ok) throw new Error(`Match failed (${res.status})`);
  return (await res.json()) as PageMatchResult;
}
