# System Architecture — Dental Laboratory CMS

## 1. Architectural Overview

The application follows a secure, decoupled, three-tier cloud architecture designed to operate continuously within free-tier quotas:

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Tier                           │
│  React 19 + TypeScript + Vite + Tailwind CSS v4 + Sonner   │
│  - Role-adaptive Layouts & Dashboards                      │
│  - React Hook Form + Zod Validations                        │
│  - TanStack Query v5 Server State & Auto-Invalidation       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WSS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Managed Backend & Auth Tier                 │
│                 Supabase (PostgreSQL 15+)                   │
│  - Supabase Auth (JWT, secure sessions, refresh cycle)     │
│  - Supabase Edge Functions (Deno Runtime)                  │
│    * `manage-users`: privileged admin, session signout     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                        Data Tier                            │
│  - PostgreSQL with Row Level Security (RLS) on all tables   │
│  - PL/pgSQL Triggers for State Machine & Sequence Counters │
│  - Append-Only Event Log (case_events, audit_logs)          │
│  - Least Privilege Grants (REVOKE UPDATE, DELETE)           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Trust Boundaries & Security Enclaves

### A. The Client (Untrusted)
- The frontend operates entirely inside the user's browser.
- **Principle**: *Never trust frontend state for security decisions.*
- Hiding UI buttons or routes is purely for user experience; all queries and mutations are guarded by RLS and database triggers on the server.
- The browser bundle holds **only** the public anonymous key (`VITE_SUPABASE_ANON_KEY`), which possesses zero default permissions beyond RLS-authorized policies.
- The `SUPABASE_SERVICE_ROLE_KEY` is **never** bundled or exposed to the browser.

### B. The Edge Function Enclave (Privileged Server-Side)
- Used for operations requiring elevated permissions that cannot be safely entrusted to direct client SQL (e.g., creating accounts in `auth.users`, updating credentials, invalidating remote user sessions).
- Authenticates the caller's JWT, verifies caller is an active Owner in `public.profiles`, and executes administrative actions using the private `SUPABASE_SERVICE_ROLE_KEY`.

### C. The Database Enclave (Source of Truth)
- Every transaction passes through PostgreSQL's internal security perimeter.
- All database mutations execute under the caller's verified `auth.uid()`.
- PL/pgSQL triggers (`validate_case_status_transition`, `protect_last_active_owner`) execute with `SECURITY DEFINER` and a fixed, sanitized `search_path = public`.

---

## 3. Data Flow & Transaction Life Cycle

### Case Registration Transaction Flow:
1. **Receptionist** completes the registration form with patient details, dentist reference, case specifications, and priority.
2. Client sends `INSERT INTO cases (...)`.
3. PostgreSQL fires `trg_auto_case_number`:
   - Runs `generate_case_number()`.
   - Executes atomic upsert with row lock on `monthly_case_counters` (`SELECT FOR UPDATE`).
   - Retrieves next sequence, formats as `CASE-YYYYMM-NNNNN`.
4. RLS verifies that caller is an active Receptionist or Owner (`cases_insert` policy).
5. Record is persisted, and initial `case_events` record is created.
6. React Query catches the mutation response, invalidates `['cases']` and `['dashboard-stats']`, and redirects to `CaseDetailPage`.

### Technician Handoff Flow:
1. **Technician** clicks "Submit to Reception" upon completing fabrication.
2. Mutation calls `useUpdateCaseStatus()` with `targetStatus = 'awaiting_reception_receipt'`.
3. PostgreSQL `trg_validate_case_status` fires:
   - Validates that previous status was `in_progress` or `completed`.
   - Confirms that the caller is the assigned technician (`cases.assigned_technician_id = auth.uid()`).
   - Updates `cases.current_status` and sets `completed_at = now()`.
4. Function `record_case_event` appends an immutable event log entry with `event_type = 'submitted_to_reception'`, attributed to the technician.
5. Case appears on the **Receptionist Dashboard** under "Awaiting Reception Receipt".
6. Receptionist physically receives the tray and clicks "Acknowledge Receipt", triggering the distinct `received_by_reception` transition.

---

## 4. Technology Stack Selection & Rationale

| Layer | Choice | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19 + TypeScript | High performance, strict type safety, wide ecosystem. |
| **Build Tool** | Vite 8 + `@tailwindcss/vite` | Sub-second HMR, optimized production tree-shaking. |
| **Styling** | Tailwind CSS v4 + Design Tokens | Accessible, mobile-responsive, zero runtime overhead. |
| **Routing** | React Router v7 | Nested layouts, declarative protected route guards. |
| **State & Cache** | TanStack Query v5 | Automatic background refetching, mutation invalidation. |
| **Database** | PostgreSQL 15 via Supabase | Relational integrity, atomic sequences, RLS security. |
| **Testing** | Vitest 5 + JSDOM | Blazing fast ESM test runner, compatible with Vite aliases. |
