# Application Security Specification & Threat Model

## 1. Security Architecture & Threat Model

The application was designed under OWASP ASVS (Application Security Verification Standard) guidelines and zero-trust principles.

```
                      [Threat: Public / Malicious User]
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Barrier 1: TLS 1.3 / Strict Content Security Policy    │
       │ Barrier 2: Supabase Auth (JWT Signed + Expiring)       │
       │ Barrier 3: Frontend Route Guards (ProtectedRoute)      │
       └────────────────────────────┬───────────────────────────┘
                                    │ (Authenticated Request)
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Barrier 4: PostgreSQL Row Level Security (RLS)         │
       │            - Filters rows by auth.uid() & role         │
       │            - Denies direct writes to immutable tables   │
       │ Barrier 5: Database Triggers & Functions               │
       │            - Server-side state transition validations  │
       │            - Owner deactivation guards                 │
       │ Barrier 6: Edge Function Sandbox (manage-users)       │
       │            - Service role key locked to server         │
       └────────────────────────────────────────────────────────┘
```

---

## 2. Core Security Controls

### A. Authentication & Session Invalidation
- Managed via Supabase Auth with PKCE and bcrypt password hashing.
- Passwords, reset tokens, and service keys are never exposed in client storage or client logs.
- When an employee is deactivated, their `profiles.status` is set to `inactive`. The frontend and API verify this status on every session check and immediately terminate access.
- The `manage-users` Edge Function executes `admin.signOut(userId, 'global')` to forcibly invalidate all active JWT refresh tokens.

### B. Row Level Security (RLS) Policies
- Enabled on all tables:
  - `profiles`: All active authenticated users can read staff profiles (for assignment names). Updates restricted to own limited fields or Owner. Deletion is completely blocked (`USING (false)`).
  - `cases`: Technicians can only SELECT and UPDATE cases where `assigned_technician_id = auth.uid()`. Insertion restricted to Receptionists and Owners. Deletion blocked.
  - `case_events`: Read restricted to case participants. Insert restricted to active users where `actor_id = auth.uid()`. UPDATE and DELETE explicitly revoked.
  - `audit_logs`: SELECT restricted exclusively to Owners. INSERT restricted to Edge Functions (service role). UPDATE and DELETE explicitly revoked.
  - `monthly_case_counters`: Direct client access blocked (`USING (false)`). Modified only through `SECURITY DEFINER` function `generate_case_number()`.

### C. Input Validation & Parameterized Queries
- Schema validation with Zod on the frontend.
- Database constraints on column lengths, email regex formats, age boundaries ($0 \le \text{age} \le 150$), and foreign key checks.
- Zero raw dynamic SQL interpolation. All queries use parameterized RPCs or the Supabase query builder.

### D. Direct Object Reference (IDOR) Prevention
- Technicians cannot mutate or query other technicians' cases simply by altering a URL or payload:
  - RLS policies filter rows at the database level.
  - The `validate_case_status_transition()` trigger verifies that `OLD.assigned_technician_id = auth.uid()`.

### E. Secrets Management
- Public client bundle contains only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` is stored strictly in server-side environment variables in the Edge Function runtime.
- `.env` and `.env.local` are explicitly added to `.gitignore`. Sanitized `.env.example` provided.

---

## 3. Residual Risks & Mitigations

1. **Supabase Free Tier Inactivity Pause**:
   - Risk: Projects on the free tier pause after 7 days of inactivity.
   - Mitigation: Documented in `docs/DEPLOYMENT.md` with instructions on unpausing and running regular off-site database backups using `scripts/backup.ps1`.
2. **Email Delivery Free Quotas**:
   - Risk: Supabase Auth free tier provides 30 built-in emails per hour.
   - Mitigation: For high-volume production, configure custom SMTP (e.g. Resend or SendGrid free tier).
