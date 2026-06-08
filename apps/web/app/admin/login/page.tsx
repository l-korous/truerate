"use client";

import { useState, type FormEvent } from "react";

export default function AdminLoginPage() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/admin/leaderboard";
        // Same-origin, app-controlled path only (avoid open-redirect).
        window.location.href = next.startsWith("/") ? next : "/admin/leaderboard";
        return;
      }
      setError(res.status === 503 ? "Admin console is not enabled on this deployment." : "Incorrect admin secret.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: "3rem 1.5rem", fontFamily: "system-ui, sans-serif", maxWidth: 380 }}>
      <h1 style={{ marginTop: 0 }}>Admin sign-in</h1>
      <p style={{ color: "#666" }}>Enter the admin secret to access the console.</p>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input
          data-testid="admin-secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Admin secret"
          aria-label="Admin secret"
          autoFocus
          style={{ padding: "0.6rem", fontSize: "1rem" }}
        />
        <button
          data-testid="admin-login"
          type="submit"
          disabled={busy || !secret}
          style={{ padding: "0.6rem", fontSize: "1rem", cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <p role="alert" data-testid="admin-login-error" style={{ color: "#b00020", marginTop: "1rem" }}>
          {error}
        </p>
      )}
    </main>
  );
}
