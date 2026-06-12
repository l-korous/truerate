"use client";

import { useState } from "react";
import Link from "next/link";
import type { CatalogEntryInput } from "@/lib/api";

const TEMPLATE_CSV = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_xyz,Hotel XYZ Loyalty,hotel,CZ,10,https://hotelxyz.example.com/book,https://hotelxyz.example.com/loyalty
hotel_abc,Hotel ABC Direct,hotel,CZ,15,https://hotelabc.example.com/,https://hotelabc.example.com/members`;

interface ParsedRow {
  programId: string;
  name: string;
  category: string;
  region: string;
  discountPercent: number;
  realizationUrl: string;
  sourceUrl: string;
}

interface RowResult {
  programId: string;
  ok: boolean;
  error?: string;
}

/**
 * Parse a CSV string where the first row is a header.
 * Expected columns: programId, name, category, region, discountPercent,
 *                   realizationUrl, sourceUrl.
 */
export function parseBulkCsv(raw: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must have a header row and at least one data row"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const required = ["programId", "name", "category", "region", "discountPercent", "realizationUrl", "sourceUrl"];
  for (const col of required) {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });

    const pct = Number(obj.discountPercent);
    if (!obj.programId) { errors.push(`Row ${i}: programId is required`); continue; }
    if (!obj.name) { errors.push(`Row ${i}: name is required`); continue; }
    if (isNaN(pct) || pct < 0 || pct > 100) { errors.push(`Row ${i}: discountPercent must be 0-100`); continue; }

    rows.push({
      programId: obj.programId,
      name: obj.name,
      category: obj.category || "hotel",
      region: obj.region || "Global",
      discountPercent: pct,
      realizationUrl: obj.realizationUrl,
      sourceUrl: obj.sourceUrl,
    });
  }

  return { rows, errors };
}

function rowToEntryInput(row: ParsedRow): CatalogEntryInput {
  const asOf = new Date().toISOString().slice(0, 7);
  const benefits: CatalogEntryInput["benefits"] = {};
  if (row.discountPercent > 0) {
    benefits["*"] = [
      {
        scope: "domain",
        value: {
          kind: "percentDiscount",
          percentOff: row.discountPercent / 100,
          conditions: "book direct",
        },
      },
    ];
  }

  return {
    programId: row.programId,
    name: row.name,
    category: row.category,
    region: row.region,
    requiresCredential: false,
    provenance: {
      source: "manual-seed",
      asOf,
      sourceUrl: row.sourceUrl || undefined,
    },
    defaultMatch: {},
    tiers: [],
    fields: [],
    benefits,
    realizationUrl: row.realizationUrl || undefined,
    openToAnyone: true,
  };
}

export default function BulkImportPage() {
  const [csv, setCsv] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleParse = () => {
    const { rows, errors } = parseBulkCsv(csv);
    setParseErrors(errors);
    setParsed(rows);
    setResults(null);
    setSubmitError(null);
  };

  const handleImport = async () => {
    if (parsed.length === 0) return;
    setImporting(true);
    setSubmitError(null);
    setResults(null);
    try {
      const entries = parsed.map(rowToEntryInput);
      const res = await fetch("/api/admin/catalog/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      });
      const data = await res.json() as { results: RowResult[]; succeeded: number; failed: number };
      setResults(data.results);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <Link href="/admin/catalog" className="text-sm text-ink-muted hover:text-ink">
            ← Catalog
          </Link>
          <span className="text-ink-muted">/</span>
          <h1 className="font-display text-2xl text-ink">Bulk import</h1>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-card p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
              Paste CSV
            </h2>
            <p className="text-xs text-ink-muted">
              Required columns:{" "}
              <code>programId, name, category, region, discountPercent, realizationUrl, sourceUrl</code>.
              Each row becomes a draft program. No prices — discountPercent is the membership discount
              %, not a room price.
            </p>
            <button
              type="button"
              onClick={() => setCsv(TEMPLATE_CSV)}
              className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Load example CSV
            </button>
            <textarea
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setParsed([]); setParseErrors([]); setResults(null); }}
              rows={10}
              spellCheck={false}
              placeholder={TEMPLATE_CSV}
              className="block w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs text-ink"
              data-testid="bulk-csv-input"
            />
            <button
              type="button"
              onClick={handleParse}
              disabled={!csv.trim()}
              className="rounded-lg border border-line bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-card disabled:opacity-50"
              data-testid="parse-button"
            >
              Parse CSV
            </button>
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-1">
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {parsed.length > 0 && (
            <div className="rounded-xl border border-line bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
                  {parsed.length} row{parsed.length !== 1 ? "s" : ""} ready to import
                </h2>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing}
                  className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
                  data-testid="import-button"
                >
                  {importing ? "Importing…" : "Import as drafts"}
                </button>
              </div>

              <div className="space-y-1" data-testid="parsed-rows">
                {parsed.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-2 text-xs"
                    data-testid={`parsed-row-${row.programId}`}
                  >
                    <span className="font-medium text-ink">{row.name}</span>
                    <span className="text-ink-muted">
                      {row.programId} · {row.category} · {row.region} · {row.discountPercent}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {submitError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </p>
          )}

          {results && (
            <div className="rounded-xl border border-line bg-card p-6 space-y-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
                Import results
              </h2>
              <div className="space-y-1" data-testid="import-results">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-lg border px-4 py-2 text-xs ${
                      r.ok
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                    data-testid={`result-${r.programId}`}
                  >
                    <span className="font-medium">{r.programId}</span>
                    <span>{r.ok ? "Draft created" : (r.error ?? "Failed")}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-muted">
                {results.filter((r) => r.ok).length} succeeded ·{" "}
                {results.filter((r) => !r.ok).length} failed.
                {results.some((r) => r.ok) && (
                  <> <Link href="/admin/catalog" className="underline underline-offset-2">View catalog</Link> to review and publish drafts.</>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
