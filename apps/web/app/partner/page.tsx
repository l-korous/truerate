"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/api";
import { PartnerDashboard } from "@/components/PartnerDashboard";

export default function PartnerPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
  }, []);

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <span className="font-display text-2xl text-ink-muted">CustomRates</span>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-4">
        <p className="text-base font-medium text-ink">Sign in to access the partner portal.</p>
        <a href="/" className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90">
          Go to sign-in
        </a>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <PartnerDashboard />
    </main>
  );
}
