---
paths:
  - "src/**/*.entity.ts"
  - "src/database/**"
  - "src/core/database/**"
---

# Database & TypeORM rules

- Table and column names in the DB are `snake_case` (match spec §3 table definitions exactly); entity
  properties are `camelCase`. Set `name:` explicitly on `@Column` / `@JoinColumn` when they differ.
- Primary keys: `@PrimaryGeneratedColumn('uuid')` unless the spec says otherwise (e.g. `rbac_policy_state.id = 1`).
- Timestamps: `timestamptz` via `@CreateDateColumn({ type: 'timestamptz', name: 'created_at' })` /
  `@UpdateDateColumn(...)`.
- Express the spec's constraints in the schema, not only in code: unique constraints (`@Unique` / `@Index({ unique: true })`),
  composite PKs, and `onDelete: 'CASCADE' | 'RESTRICT'` on relations exactly as listed in the spec.
- Postgres enums for closed sets like user `status` and `consumed_reason`.
- Add indexes for keyset pagination tuples like `(created_at, id)`.
- Never store secrets in plain text: passwords → Argon2id hash, OTP / magic-link secrets → HMAC-SHA256.
- Every schema change ships with a migration. Generate with `npm run migration:generate` (DB running),
  review the generated SQL, then make sure `down()` really reverses `up()`.
- Do not edit a migration that has already been run/committed — create a new one.
- Wrap multi-step writes in `@Transactional()`; invariants such as "at least one `rbac@manage` admin"
  must be checked inside the same transaction as the write.
