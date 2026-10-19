import { ar } from './ar';

type DbErrorKey = keyof typeof ar.errors.db;

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  hint?: unknown;
  name?: unknown;
  status?: unknown;
}

function isDbErrorKey(value: unknown): value is DbErrorKey {
  return typeof value === 'string' && value in ar.errors.db;
}

/**
 * Convert any error (Postgres/PostgREST, Supabase Auth, Edge Function, network)
 * into a safe Arabic message. Raw English details are never returned; they are
 * only logged in development.
 */
export function errorMessage(err: unknown): string {
  if (import.meta.env.DEV && err) console.error('[error]', err);

  const e: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : {};
  const { generic, auth } = ar.errors;

  // 1. Stable keys raised by our database functions (migration 003+).
  if (isDbErrorKey(e.hint)) return ar.errors.db[e.hint];

  const code = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';

  // 2. Supabase Auth.
  if (code === 'invalid_credentials' || message === 'Invalid login credentials') return auth.invalidCredentials;
  if (code === 'email_not_confirmed') return auth.emailNotConfirmed;
  if (code.startsWith('over_') && code.endsWith('_rate_limit')) return auth.rateLimited;
  if (code === 'session_expired' || code === 'refresh_token_not_found') return auth.sessionExpired;

  // 3. Postgres / PostgREST codes.
  if (code === '42501') return generic.permissionDenied;
  if (code === '23505') return generic.duplicate;
  if (['23502', '23503', '23514', '22P02', '22001', '22003', '22007', '22008'].includes(code)) {
    return generic.invalidData;
  }
  if (code === 'PGRST116') return generic.notFound;

  // 4. Edge Functions and network.
  if (name === 'FunctionsHttpError' || name === 'FunctionsRelayError') return generic.server;
  if (name === 'FunctionsFetchError' || /failed to fetch|network/i.test(message)) return generic.network;

  return generic.unknown;
}
