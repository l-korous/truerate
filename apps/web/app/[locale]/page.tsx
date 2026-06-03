"use client";

import { useEffect, useState } from "react";
import { api, getToken, type PublicUser } from "@/lib/api";
import { track } from "@/lib/analytics";
import { AuthScreen } from "@/components/Auth";
import { Dashboard } from "@/components/Dashboard";

export default function LocaleHome() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track({ name: "landing_visit" });
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <span className="font-display text-2xl text-ink-muted">TrueRate</span>
      </div>
    );
  }

  return user ? (
    <Dashboard user={user} onSignOut={() => setUser(null)} />
  ) : (
    <AuthScreen onAuth={setUser} />
  );
}
