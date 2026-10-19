# Security Verification Checklist

| Security Control | OWASP Category | Implementation Mechanism | Verification Evidence | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Authentication Enforcement** | A07:2021 Identification & Auth | Supabase Auth + JWT + `ProtectedRoute` | Vitest auth guards & ProtectedRoute | ✅ PASS |
| **Server-Side Role Checks** | A01:2021 Broken Access Control | RLS policies & `get_user_role()` function | Negative authorization tests in `permissions.test.ts` | ✅ PASS |
| **IDOR Protection** | A01:2021 Broken Access Control | Case assignment check in RLS & triggers | `permissions.test.ts` IDOR simulation | ✅ PASS |
| **Protection of Last Owner** | A01:2021 Broken Access Control | DB trigger `trg_protect_last_active_owner` | `employeeAdmin.test.ts` last owner test | ✅ PASS |
| **Session Revocation on Deactivation** | A07:2021 Identification & Auth | `profiles.status = 'inactive'` check & global signOut | `AuthContext` active check + `manage-users` | ✅ PASS |
| **Reassign Active Cases on Deactivation** | A04:2021 Insecure Design | Function `reassign_and_deactivate_technician` | Tested in `employeeAdmin.test.ts` | ✅ PASS |
| **State Machine Database Enforcement** | A04:2021 Insecure Design | DB trigger `trg_validate_case_status` | 4 tests in `stateMachine.test.ts` | ✅ PASS |
| **Immutable Case History** | A09:2021 Logging & Monitoring | `REVOKE UPDATE, DELETE ON case_events` | Schema migration permissions | ✅ PASS |
| **Immutable Administrative Audit** | A09:2021 Logging & Monitoring | `REVOKE UPDATE, DELETE ON audit_logs` | Schema migration permissions | ✅ PASS |
| **Safe Case Number Generation** | A04:2021 Insecure Design | Atomic `SELECT FOR UPDATE` monthly counter | 5 tests in `caseNumber.test.ts` | ✅ PASS |
| **Secrets Segregation** | A05:2021 Security Misconfig | Service role key confined to Edge Functions | Vite production bundle review (0 secrets) | ✅ PASS |
| **Parameterized Queries** | A03:2021 Injection | Supabase JS client parameterized builders | Static code analysis & typed RPCs | ✅ PASS |
| **XSS & Content Security** | A03:2021 Injection | React virtual DOM auto-escaping | No `dangerouslySetInnerHTML` in codebase | ✅ PASS |
| **Input Schema Limits** | A04:2021 Insecure Design | Zod schemas + DB check constraints | DB migrations schema constraints | ✅ PASS |
| **Free-Tier Backup & Disaster Recovery** | A05:2021 Security Misconfig | `scripts/backup.ps1` and `scripts/backup.sh` | Executable backup & restore scripts | ✅ PASS |
