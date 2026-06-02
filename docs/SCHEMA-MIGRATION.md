# Cosmos Schema-Change Policy

TrueRate runs on Azure Cosmos DB (NoSQL, serverless). During a canary or
blue/green rollout both the **stable** revision and the **new** revision of every
Container App run simultaneously against the **same** Cosmos container. A
schema change that breaks old readers would corrupt live reads on the stable
revision.

This document defines the mandatory policy for all user-document schema changes.

---

## The expand-then-contract pattern

Every schema change goes through **three separate deploys**, never one:

```
Deploy A  – EXPAND:    add new optional field(s); old readers ignore them.
Deploy B  – MIGRATE:   backfill / use new field; remove transitional read-paths.
Deploy C  – CONTRACT:  drop obsolete field(s) once no old revision is live.
```

No single deploy may change existing field names, remove required fields, or
change field semantics in a way that causes an old revision to misread a document.

### What counts as a breaking change

| Change type | Breaking? | Action required |
|---|---|---|
| Add an optional field | No | Safe in one deploy |
| Add a required field | **Yes** | Expand first (optional), contract later |
| Rename a field | **Yes** | Expand (add new), migrate reads, contract (remove old) |
| Remove a field | **Yes** | Contract only after all revisions ignore it |
| Change a field's type | **Yes** | Add new field with new type; migrate; remove old |
| Narrow an enum / union | **Yes** | Keep old values readable; drop in contract deploy |

---

## `schemaVersion` convention

Every User document carries a `schemaVersion: number` field.

- Documents written **before** this field was introduced are implicitly **version 1**.
- The current version is exported as `USER_SCHEMA_VERSION` from `packages/core/src/types.ts`.
- Every `create` and `update` in `packages/core/src/db.ts` writes
  `schemaVersion: USER_SCHEMA_VERSION` so documents are self-describing.

### Version history

| Version | Introduced | Changes |
|---|---|---|
| 1 | 2026-06 | Initial schema. All fields present at repo creation. `schemaVersion` field added (optional, defaults to 1 for legacy docs). |

### Bumping the version

1. Increment `USER_SCHEMA_VERSION` in `types.ts`.
2. Add any new optional fields to the `User` interface.
3. Add a migration case to `normalizeUser()` in `db.ts` to fill safe defaults
   for documents at the previous version.
4. Update the version history table above.
5. In a later **contract** deploy: remove the migration branch once all documents
   are at the new version and no old revision is live.

---

## `normalizeUser()` — multi-version read path

`packages/core/src/db.ts` exports `normalizeUser(raw: User): User`.

All read operations (`getById`, `getByEmail`) pass the raw Cosmos document
through `normalizeUser` before returning it to callers. All write operations
(`create`, `update`) stamp the document with `schemaVersion: USER_SCHEMA_VERSION`
before persisting.

This means:

- **Callers always receive a fully-shaped User** regardless of which revision
  wrote the document.
- **Old revisions** read documents written by the new revision safely (optional
  field — ignored).
- **New revisions** read documents written by the old revision safely
  (`normalizeUser` fills defaults).

### Adding a migration step

```ts
export function normalizeUser(raw: User): User {
  const version = raw.schemaVersion ?? 1;

  if (version < 2) {
    // v1 → v2: newField was added as optional; default to false.
    (raw as { newField?: boolean }).newField ??= false;
  }

  // ... further version steps ...

  return { ...raw, schemaVersion: USER_SCHEMA_VERSION };
}
```

---

## Checklist for every schema-changing PR

Before merging a PR that modifies `User`, `CatalogEntryDoc`, or any other
Cosmos document type:

- [ ] The change follows expand-then-contract (one deploy per phase).
- [ ] New fields are marked `?` (optional) in the TypeScript interface.
- [ ] `normalizeUser()` (or the equivalent for catalog docs) handles documents
      missing the new field.
- [ ] `USER_SCHEMA_VERSION` is incremented if the shape changes.
- [ ] Version history table in this doc is updated.
- [ ] Unit tests cover both "old doc without the field" and "new doc with the field".
- [ ] PR description explains which deploy phase this is (expand / migrate / contract).

---

## Catalog documents

`CatalogEntryDoc` (see `types.ts`) already uses an immutable versioning scheme:
each catalog entry version is a separate Cosmos document with id
`{programId}#v{version}`. The `isCurrent` flag points to the live entry.
This is an append-only design — old documents are never mutated — so catalog
entries are inherently backward-compatible. No `schemaVersion` field is needed
for catalog entries at this time.

---

## References

- Issue [#31](https://github.com/l-korous/truerate/issues/31) — policy inception
- Issue [#27](https://github.com/l-korous/truerate/issues/27) — multi-revision overlap
- `packages/core/src/types.ts` — `USER_SCHEMA_VERSION`, `User`
- `packages/core/src/db.ts` — `normalizeUser()`
- `docs/DEPLOYMENT.md` — CI/CD and blue/green deploy context
