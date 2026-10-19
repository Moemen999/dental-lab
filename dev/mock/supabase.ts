/**
 * DEV-ONLY fake Supabase client for `npm run dev:mock`.
 * Swapped in for src/lib/supabase.ts by vite.mock.config.ts; never part of the
 * production build. Answers the queries the app makes from in-memory fake data.
 *
 * Sign in as a role with ?as=owner|receptionist|technician|representative
 * (or with owner@demo.test, reception@demo.test, karim.tech@demo.test, rep@demo.test).
 * ?fail=1 makes status changes fail with a database error, to preview error messages.
 */
import { VALID_TRANSITIONS, type CaseStatus } from '@/types/database';
import { AUDIT_LOGS, BATCHES, BATCH_CASES, CASES, DENTISTS, EVENTS, PROFILES, WORK_TYPES } from './fixtures';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown; count?: number | null };

const ROLE_USERS: Record<string, string> = {
  owner: 'u-owner',
  receptionist: 'u-recep',
  technician: 'u-tech1',
  representative: 'u-rep',
};
const STORAGE_KEY = 'dental-lab-mock-user';

function currentUserId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const as = params.get('as');
  if (as && ROLE_USERS[as]) sessionStorage.setItem(STORAGE_KEY, ROLE_USERS[as]);
  return sessionStorage.getItem(STORAGE_KEY);
}

const TABLES: Record<string, Row[]> = {
  profiles: PROFILES as unknown as Row[],
  dentists: DENTISTS as unknown as Row[],
  cases: CASES as unknown as Row[],
  case_events: EVENTS as unknown as Row[],
  delivery_batches: BATCHES as unknown as Row[],
  batch_cases: BATCH_CASES as unknown as Row[],
  audit_logs: AUDIT_LOGS as unknown as Row[],
  technician_assignments: [],
  work_types: WORK_TYPES as unknown as Row[],
};

function decorate(table: string, row: Row): Row {
  if (table === 'cases') {
    return {
      ...row,
      dentist: DENTISTS.find((d) => d.id === row.dentist_id) ?? null,
      assigned_technician: PROFILES.find((p) => p.id === row.assigned_technician_id) ?? null,
    };
  }
  if (table === 'batch_cases') return { ...row, case: CASES.find((c) => c.id === row.case_id) ?? null };
  return row;
}

class Query implements PromiseLike<Result> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private wantSingle = false;
  private head = false;
  private from = 0;
  private to = Number.POSITIVE_INFINITY;
  private sortKey: string | null = null;
  private ascending = true;
  private table: string;

  constructor(table: string) {
    this.table = table;
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.head = true;
    return this;
  }
  insert(payload: Row) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  upsert(payload: Row) {
    return this.insert(payload);
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && String(r[col]) < String(val));
    return this;
  }
  not(col: string, op: string, val: string) {
    if (op === 'in') {
      const values = val.replace(/[()"]/g, '').split(',');
      this.filters.push((r) => !values.includes(String(r[col])));
    }
    return this;
  }
  /** Same matching as public.search_cases (migration 011). */
  search(query: string) {
    const term = query.trim().toLowerCase();
    this.filters.push(
      (r) =>
        String(r.case_number ?? '').toLowerCase().includes(term) ||
        String(r.patient_name ?? '').toLowerCase().includes(term),
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sortKey = col;
    this.ascending = opts?.ascending ?? true;
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }

  private run(): Result {
    const rows = TABLES[this.table] ?? [];
    if (this.table === 'work_types' && 'name' in this.payload) {
      const name = String(this.payload.name ?? '').trim();
      const ownId = this.op === 'update' ? rows.find((r) => this.filters.every((f) => f(r)))?.id : undefined;
      if (!name) return { data: null, error: { code: 'P0001', message: 'invalid', hint: 'err.work_type.invalid_name' } };
      if (rows.some((r) => String(r.name).trim().toLowerCase() === name.toLowerCase() && r.id !== ownId)) {
        return { data: null, error: { code: 'P0001', message: 'duplicate', hint: 'err.work_type.duplicate' } };
      }
      this.payload = { ...this.payload, name };
    }
    if (this.op === 'insert') {
      const row: Row = { id: `new-${Date.now()}`, created_at: new Date().toISOString(), is_active: true, ...this.payload };
      if (this.table === 'cases') {
        row.case_number = `CASE-202610-${String(rows.length + 1).padStart(5, '0')}`;
        row.current_status = row.assigned_technician_id ? 'assigned' : 'awaiting_assignment';
      }
      rows.unshift(row);
      return { data: decorate(this.table, row), error: null };
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      matched.forEach((r) => Object.assign(r, this.payload));
      return { data: this.wantSingle ? decorate(this.table, matched[0]) : matched, error: null };
    }
    if (this.sortKey) {
      const k = this.sortKey;
      matched = [...matched].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (this.ascending ? 1 : -1));
    }
    const count = matched.length;
    if (this.head) return { data: null, error: null, count };
    const page = matched.slice(this.from, this.to + 1).map((r) => decorate(this.table, r));
    if (this.wantSingle) {
      return page[0]
        ? { data: page[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: page, error: null, count };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return new Promise<Result>((resolve) => setTimeout(() => resolve(this.run()), 120)).then(onfulfilled, onrejected);
  }
}

type AuthCallback = (event: string, session: unknown) => void;
const listeners = new Set<AuthCallback>();

function session() {
  const id = currentUserId();
  const p = PROFILES.find((x) => x.id === id);
  return p ? { user: { id: p.id, email: p.email } } : null;
}

const dbError = (hint: string, message: string) => ({ code: 'P0001', message, hint, details: null });

export const supabase = {
  from: (table: string) => new Query(table),

  rpc(name: string, args: Record<string, unknown>, _opts?: { count?: string }) {
    // Set-returning function: chainable like a table query.
    if (name === 'search_cases') return new Query('cases').search(String(args.p_query ?? ''));
    return callRpc(name, args);
  },

  functions: {
    async invoke() {
      return { data: { success: true, user: PROFILES[0] }, error: null };
    },
  },

  auth: {
    async getSession() {
      return { data: { session: session() }, error: null };
    },
    onAuthStateChange(cb: AuthCallback) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      const p = PROFILES.find((x) => x.email === email && x.status === 'active');
      if (!p) return { data: null, error: { name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } };
      sessionStorage.setItem(STORAGE_KEY, p.id);
      listeners.forEach((cb) => cb('SIGNED_IN', session()));
      return { data: session(), error: null };
    },
    async signOut() {
      sessionStorage.removeItem(STORAGE_KEY);
      listeners.forEach((cb) => cb('SIGNED_OUT', null));
      return { error: null };
    },
    async resetPasswordForEmail() {
      return { data: {}, error: null };
    },
  },
};

async function callRpc(name: string, args: Record<string, unknown>) {
    await new Promise((r) => setTimeout(r, 150));
    if (name === 'transition_case_status') {
      const c = CASES.find((x) => x.id === args.p_case_id);
      if (!c) return { data: null, error: dbError('err.case.not_found', 'Case not found or not permitted') };
      const to = args.p_new_status as CaseStatus;
      const failRequested = new URLSearchParams(window.location.search).get('fail') === '1';
      if (failRequested || !VALID_TRANSITIONS[c.current_status].includes(to)) {
        return { data: null, error: dbError('err.case.invalid_transition', `Invalid status transition from ${c.current_status} to ${to}`) };
      }
      const prev = c.current_status;
      c.current_status = to;
      EVENTS.push({
        id: `e-${Date.now()}`, case_id: c.id, event_type: 'info_updated', previous_status: prev, new_status: to,
        actor_id: currentUserId() ?? '', sender_id: null, receiver_id: null, notes: (args.p_notes as string) ?? null,
        metadata: {}, batch_id: null, assignment_id: null, created_at: new Date().toISOString(),
        actor: PROFILES.find((p) => p.id === currentUserId()),
      } as (typeof EVENTS)[number]);
      return { data: c, error: null };
    }
    if (name === 'record_case_event') return { data: `e-${Date.now()}`, error: null };
    if (name === 'get_employee_outstanding_work') {
      const active = CASES.filter((c) => c.assigned_technician_id === args.p_user_id && !['delivered', 'cancelled'].includes(c.current_status));
      return {
        data: { user_id: args.p_user_id, role: 'technician', active_case_count: active.length, active_cases: active, open_batch_count: 0, open_batches: [] },
        error: null,
      };
    }
    if (name === 'reassign_and_deactivate_technician') return { data: { success: true }, error: null };
    return { data: null, error: { code: '42883', message: `function ${name} does not exist` } };
}
