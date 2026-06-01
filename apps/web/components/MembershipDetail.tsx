"use client";

import type { Benefit, BenefitValue, Program, PublicMembership } from "@/lib/api";

function StatusBadge({ status }: { status: PublicMembership["status"] }) {
  const styles: Record<PublicMembership["status"], string> = {
    active: "bg-save-soft text-save",
    unverified: "bg-points-soft text-points",
    invalid: "bg-red-50 text-red-600",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function benefitSummary(v: BenefitValue): string {
  if (v.kind === "percentDiscount" && v.percentOff != null) return `${Math.round(v.percentOff * 100)}% off`;
  if (v.kind === "fixedDiscount" && v.amountOff != null) return `${v.amountOff} off`;
  if (v.kind === "pointsEarn") return "Earns points / miles";
  if (v.kind === "perk" && v.perks?.length) return v.perks.join(", ");
  return v.kind;
}

function BenefitRow({ benefit }: { benefit: Benefit }) {
  const summary = benefitSummary(benefit.value);
  const matches: string[] = [
    ...(benefit.match.brands ?? []),
    ...(benefit.match.domains ?? []),
    ...(benefit.match.propertyNames ?? []),
    ...(benefit.match.categories ?? []),
  ];
  return (
    <li className="rounded-xl border border-line bg-paper px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">{summary}</p>
          {benefit.value.conditions && (
            <p className="mt-0.5 text-xs text-ink-muted">{benefit.value.conditions}</p>
          )}
          {matches.length > 0 && (
            <p className="mt-0.5 text-xs text-ink-muted">Applies to: {matches.join(", ")}</p>
          )}
        </div>
        <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted ring-1 ring-line">
          {benefit.scope}
        </span>
      </div>
    </li>
  );
}

export function MembershipDetail({
  membership,
  program,
  onBack,
  onRemove,
}: {
  membership: PublicMembership;
  program?: Program;
  onBack: () => void;
  onRemove: () => void;
}) {
  const isCustom = !membership.programId;
  const secretKeys = new Set(program?.fields.filter((f) => f.secret).map((f) => f.key) ?? []);

  const attributeEntries = Object.entries(membership.attributes).filter(([, v]) => v !== "");

  const fieldLabel = (key: string): string =>
    program?.fields.find((f) => f.key === key)?.label ?? key;

  return (
    <div data-testid="membership-detail">
      <div className="mb-6 flex items-center gap-3">
        <button
          className="btn-ghost"
          data-testid="membership-detail-back"
          onClick={onBack}
        >
          ← Back
        </button>
        <h1 className="font-display text-2xl text-ink">{membership.label}</h1>
      </div>

      <div className="space-y-6">
        {/* Header card */}
        <div className="rounded-xl2 border border-line bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={membership.status} />
            {membership.tier && (
              <span className="rounded px-2 py-0.5 text-xs font-medium ring-1 ring-line text-ink">
                {membership.tier}
              </span>
            )}
            <span className="text-xs text-ink-muted">{isCustom ? "Custom benefit" : "Catalog program"}</span>
          </div>

          {membership.hasCredential ? (
            <p className="mt-3 text-sm text-save">
              Credential stored (encrypted) — used for automated verification.
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No credential stored.</p>
          )}
        </div>

        {/* Benefits */}
        {membership.benefits.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-lg text-ink">Benefits</h2>
            <ul className="space-y-2" data-testid="detail-benefits">
              {membership.benefits.map((b) => (
                <BenefitRow key={b.id} benefit={b} />
              ))}
            </ul>
          </section>
        )}

        {/* Attributes */}
        {attributeEntries.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-lg text-ink">Your details</h2>
            <dl className="rounded-xl2 border border-line bg-card divide-y divide-line">
              {attributeEntries.map(([key, val]) => (
                <div key={key} className="flex justify-between px-5 py-3">
                  <dt className="text-sm text-ink-muted">{fieldLabel(key)}</dt>
                  <dd className="text-sm text-ink" data-testid={`attr-${key}`}>
                    {secretKeys.has(key) ? (
                      <span className="text-ink-muted italic">encrypted</span>
                    ) : (
                      val
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Danger zone */}
        <div className="flex justify-end pt-2">
          <button
            className="text-sm text-ink-muted hover:text-red-600"
            data-testid="detail-remove"
            onClick={onRemove}
          >
            Remove membership
          </button>
        </div>
      </div>
    </div>
  );
}
