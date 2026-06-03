# Cosmos DB Schema Migration Policy

## Why this policy exists

During a canary or blue/green rollout, two revisions of the application run
against the **same** serverless Cosmos DB account simultaneously. A deploy that
changes a user-document field in a breaking way (rename, remove, change type)
would corrupt reads on the still-live stable revision. This policy prevents that.

Reference: issue [#31](https://github.com/l-korous/truerate/issues/31);
aligns with multi-revision overlap [#27](https://github.com/l-korous/truerate/issues/27).

---

## Hard rule

**No single deploy may change an existing user-document field in a breaking way.**

A "breaking change" is any of:
- Removing a field that an older revision may read.
- Renaming a field that an older revision reads under the old name.
- Changing a field's type in a way that causes an older revision to fail.
- Changing the partition key path.

---

## Expand / migrate / contract (three separate deploys)

All structural schema changes follow this three-step process:

```
Deploy N     Expand      Add the new field as optional.
                         Old revisions ignore it; new revisions write it.

(background) Migrate     Back-fill the new field on existing documents if needed.
                         Done lazily on read (see normalizeUser) or by a one-off job.

Deploy N+1   Contract    Remove / rename the old field (if this was a rename/split).
                         Only safe once every live revision reads the new field.
```

### Expand (Deploy N)

1. Add the new field as **optional** (`field?: Type`) in `packages/core/src/types.ts`.
2. New documents written by Deploy N include the field; old documents do not.
3. Both the old and new revisions run without errors. Old revisions skip the
   unknown field; new revisions set a default when the field is absent.
4. `normalizeUser()` in `packages/core/src/db.ts` fills in the default for any
   document that lacks the field (see [Schema versioning](#schema-versioning)).

### Migrate (background, between deploys)

Lazy migration via `normalizeUser()` is sufficient for most cases — old documents
get the new field the next time they are read and written. If a field must be
present on all documents before Deploy N+1 (e.g. for a new index), run a
one-off migration job **before** Deploy N+1:

```bash
# Example: stamp schemaVersion on all existing documents
az cosmosdb ... # bulk update via Container Apps Job or a one-off script
```

The job must be idempotent (re-running is safe) and backward-compatible (it only
adds / rewrites the new field; it never removes the old one until Deploy N+1).

### Contract (Deploy N+1, optional)

Once every live revision has been updated to write and read only the new field,
the old field may be removed in a subsequent deploy. This step is **optional** —
leaving an unused optional field in the schema is harmless.

---

## Schema versioning

### `USER_SCHEMA_VERSION` constant (`packages/core/src/types.ts`)

Every `User` document carries an optional `schemaVersion: number`. The current
target version is exported as `USER_SCHEMA_VERSION`. Documents written before
versioning was introduced have no `schemaVersion` field (treat as version 0).

| Value | Meaning |
|-------|---------|
| absent / `undefined` | Version 0 — original shape, no `schemaVersion` field |
| `1` | Version 1 — `schemaVersion` field added |

Increment `USER_SCHEMA_VERSION` when introducing a new expand step that requires
in-code migration logic.

### `normalizeUser()` (`packages/core/src/db.ts`)

`normalizeUser(raw: User): User` upgrades a stored document to the current schema
shape **in memory** without persisting the change. Every read path in
`CosmosUserRepo` and `MemoryUserRepo` passes documents through this function.

Rules:
- Returns the object unchanged if `schemaVersion >= USER_SCHEMA_VERSION`.
- Applies each version step in sequence for older documents.
- The returned object is **not** automatically persisted — it is only written
  back to Cosmos when the caller updates the document for a real business reason
  (to avoid spurious write amplification on read-only paths).

### Adding a new version step

1. Bump `USER_SCHEMA_VERSION` in `types.ts`.
2. Add the new optional field(s) to the `User` interface.
3. Add a migration block inside `normalizeUser()`:
   ```ts
   // v1 → v2: add newField with default value
   if (version < 2) {
     return { ...raw, schemaVersion: 2, newField: raw.newField ?? defaultValue };
   }
   ```
4. Add a unit test in `packages/core/test/db.test.ts` that verifies a raw v1
   document is correctly normalized to v2.

---

## Cosmos partition-key changes

The partition key (`/id` for `users`) **cannot** be changed without creating a
new container and migrating all data. This is a destructive operation requiring:

1. A feature-flagged deploy that writes to **both** containers in parallel.
2. A migration job to copy all existing documents.
3. A cutover deploy that switches reads to the new container.
4. A cleanup deploy that removes the old container.

This is a major operation — schedule it as its own issue and epic.

---

## Checklist for any schema change PR

- [ ] New/changed fields are optional in the current PR (Expand step only).
- [ ] `normalizeUser()` handles the absence of the new field (default value).
- [ ] `USER_SCHEMA_VERSION` is incremented if migration logic is added.
- [ ] A unit test covers the normalization of a document at the previous version.
- [ ] The PR description notes which deploy phase this is (Expand / Migrate / Contract).
- [ ] No breaking changes to existing optional or required fields.
