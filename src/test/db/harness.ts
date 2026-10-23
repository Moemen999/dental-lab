/**
 * PGlite test harness: runs the REAL SQL migrations from supabase/migrations
 * on an in-process Postgres with a Supabase-like auth layer:
 * - roles anon / authenticated / service_role
 * - auth.users + auth.uid() reading the request JWT claims (same as Supabase)
 * - Supabase default privileges (public tables/functions granted to anon & authenticated)
 *
 * Set DB_MIGRATIONS_EXCLUDE=003 to run against the schema before a migration
 * (used to prove a test fails before its fix).
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../supabase/migrations');

const SUPABASE_STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    email_confirmed_at timestamptz
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  const exclude = (process.env.DB_MIGRATIONS_EXCLUDE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !exclude.some((prefix) => f.startsWith(prefix)))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

/** Fake staff accounts (no real data). */
export const USERS = {
  owner: '00000000-0000-4000-8000-000000000001',
  receptionist: '00000000-0000-4000-8000-000000000002',
  techA: '00000000-0000-4000-8000-000000000003',
  techB: '00000000-0000-4000-8000-000000000004',
  rep: '00000000-0000-4000-8000-000000000005',
  idleTech: '00000000-0000-4000-8000-000000000006',
  rep2: '00000000-0000-4000-8000-000000000007',
} as const;

export type Caller =
  | { role: 'anon' }
  | { role: 'service_role' }
  | { role: 'authenticated'; uid: string };

export async function seedStaff(db: PGlite): Promise<void> {
  const roles: Record<keyof typeof USERS, string> = {
    owner: 'owner',
    receptionist: 'receptionist',
    techA: 'technician',
    techB: 'technician',
    rep: 'representative',
    idleTech: 'technician',
    rep2: 'representative',
  };
  for (const [key, id] of Object.entries(USERS)) {
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
       VALUES ($1, $2, $3, now())`,
      [id, `${key.toLowerCase()}@example.test`, JSON.stringify({ full_name: `Test ${key}` })],
    );
    // Seeding runs as the database owner (like the Supabase SQL editor).
    await db.query(`UPDATE profiles SET role = $2::app_role, status = 'active' WHERE id = $1`, [
      id,
      roles[key as keyof typeof USERS],
    ]);
  }
}

export interface AttemptResult<T> {
  ok: boolean;
  rows: T[];
  error?: string;
  /** Stable error key from `RAISE ... USING HINT = 'err.…'` (migration 003+). */
  hint?: string;
}

function errorHint(e: unknown): string | undefined {
  const hint = (e as { hint?: unknown } | null)?.hint;
  return typeof hint === 'string' ? hint : undefined;
}

async function applyCaller(tx: Transaction, caller: Caller) {
  const claims =
    caller.role === 'authenticated'
      ? { sub: caller.uid, role: 'authenticated' }
      : { role: caller.role };
  await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await tx.exec(`SET LOCAL ROLE ${caller.role}`);
}

/**
 * Runs one statement as the given API caller inside a transaction.
 * `keep: false` (default) rolls back afterwards so attempts don't leak state.
 */
export async function attempt<T = Record<string, unknown>>(
  db: PGlite,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
  { keep = false }: { keep?: boolean } = {},
): Promise<AttemptResult<T>> {
  let result: AttemptResult<T> = { ok: false, rows: [] };
  try {
    await db.transaction(async (tx) => {
      await applyCaller(tx, caller);
      const r = await tx.query<T>(sql, params);
      result = { ok: true, rows: r.rows };
      if (!keep) await tx.rollback();
    });
  } catch (e) {
    result = { ok: false, rows: [], error: e instanceof Error ? e.message : String(e), hint: errorHint(e) };
  }
  return result;
}

/**
 * Like `attempt`, but runs several statements as the caller in one transaction
 * (needed when a later statement must see rows written by triggers of an earlier one).
 * Always rolls back.
 */
export async function attemptTx<T>(
  db: PGlite,
  caller: Caller,
  body: (tx: Transaction) => Promise<T>,
): Promise<{ ok: boolean; value?: T; error?: string }> {
  let out: { ok: boolean; value?: T; error?: string } = { ok: false };
  try {
    await db.transaction(async (tx) => {
      await applyCaller(tx, caller);
      out = { ok: true, value: await body(tx) };
      await tx.rollback();
    });
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return out;
}

export const as = {
  anon: { role: 'anon' } as Caller,
  service: { role: 'service_role' } as Caller,
  user: (uid: string): Caller => ({ role: 'authenticated', uid }),
};

/** Creates a case directly as the DB owner (trusted seed path). */
export async function seedCase(
  db: PGlite,
  fields: { status: string; technician?: string | null; patient?: string },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO cases (patient_name, case_type, current_status, assigned_technician_id)
     VALUES ($1, 'Crown', $2::case_status, $3) RETURNING id`,
    [fields.patient ?? 'Fake Patient', fields.status, fields.technician ?? null],
  );
  return r.rows[0].id;
}

/** Creates a delivery batch directly as the DB owner (trusted seed path). */
export async function seedBatch(
  db: PGlite,
  fields: { reference: string; representative?: string | null; status?: string; type?: string },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO delivery_batches (batch_reference, batch_type, status, representative_id, expected_count)
     VALUES ($1, $2::batch_type, $3::batch_status, $4, 3) RETURNING id`,
    [fields.reference, fields.type ?? 'intake', fields.status ?? 'open', fields.representative ?? null],
  );
  return r.rows[0].id;
}

/** True when a table exists (lets older test files run before a migration is applied). */
export async function tableExists(db: PGlite, name: string): Promise<boolean> {
  const r = await db.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [`public.${name}`]);
  return r.rows[0].t !== null;
}

/** Adds a work type as the DB owner (test fixture only; no-op before migration 005). */
export async function seedWorkType(db: PGlite, name: string, isActive = true): Promise<string | null> {
  if (!(await tableExists(db, 'work_types'))) return null;
  const r = await db.query<{ id: string }>(
    `INSERT INTO work_types (name, is_active) VALUES ($1, $2) RETURNING id`,
    [name, isActive],
  );
  return r.rows[0].id;
}

/** True when a column exists (lets older test files run before a migration is applied). */
export async function columnExists(db: PGlite, table: string, column: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

/**
 * Extra INSERT column/value for a case registered from the app: from migration 014
 * a new case needs at least one jaw. Empty before 014 so older test files still run.
 * Usage: `INSERT INTO cases (patient_name, case_type${jaw.col}) VALUES ('x', 'y'${jaw.val})`
 */
export async function appCaseJaw(db: PGlite): Promise<{ col: string; val: string }> {
  return (await columnExists(db, 'cases', 'upper_jaw'))
    ? { col: ', upper_jaw', val: ', true' }
    : { col: '', val: '' };
}

/** True when a trigger exists (lets older test files run before a migration is applied). */
export async function triggerExists(db: PGlite, name: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = $1`, [name]);
  return r.rows.length > 0;
}
