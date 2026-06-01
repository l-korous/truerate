"use client";

import { type PublicUser } from "@/lib/api";

function pretty(id: string) { return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

export function MemberPerks({ user }: { user: PublicUser }) {
  const allPerks = user.memberships.flatMap((m) =>
    m.benefits.flatMap((b) => {
      const lines: string[] = [];
      const v = b.value;
      if (v.kind === "percentDiscount" && v.percentOff) lines.push(`${Math.round(v.percentOff * 100)}% off`);
      for (const p of v.perks ?? []) lines.push(p);
      if (v.conditions) lines.push(`Conditions: ${v.conditions}`);
      return lines.map((line) => ({ membership: m.label, line, scope: b.scope }));
    })
  );

  if (user.memberships.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-line bg-white/50 p-12 text-center">
        <p className="font-display text-xl text-ink">No memberships yet</p>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          Add memberships on the Memberships tab to see which discounts and perks apply to your stays.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {user.memberships.map((m) => {
        const benefits = m.benefits.flatMap((b) => {
          const lines: string[] = [];
          const v = b.value;
          if (v.kind === "percentDiscount" && v.percentOff) lines.push(`${Math.round(v.percentOff * 100)}% off`);
          for (const p of v.perks ?? []) lines.push(p);
          if (v.conditions) lines.push(`Conditions: ${v.conditions}`);
          return lines.map((line) => ({ line, scope: b.scope }));
        });

        return (
          <div key={m.id} className="rounded-xl2 border border-line bg-card p-5" data-testid="perk-card">
            <p className="font-medium text-ink">{m.label}</p>
            {m.programId && <p className="text-xs text-ink-muted">{pretty(m.programId)}</p>}
            {benefits.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {benefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-save" />
                    <span className="text-ink">{b.line}</span>
                    {b.scope !== "global" && <span className="text-xs text-ink-muted">({b.scope})</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No specific discounts or perks on file.</p>
            )}
          </div>
        );
      })}
      <p className="mt-4 text-xs text-ink-muted" data-testid="perks-note">
        Discounts (%) and perks shown are exact from your membership catalog. Connect the MCP server or browser extension to apply these automatically when searching hotels.
      </p>
    </div>
  );
}
