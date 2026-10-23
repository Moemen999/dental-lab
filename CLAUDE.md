# CLAUDE.md — Agent & Developer Orientation Guide

Welcome! This repository contains the complete, working **Dental Laboratory Case Management System (CMS)**. This file provides everything an AI coding agent (like Claude Code) or human software engineer needs to understand, run, develop, test, and deploy the application with zero extra context.

---

## 1. Project Location & Repository Status

- **Stable Working Path**: `E:\dental-lab`
- **Repository Type**: Standalone Git repository (not a worktree).
- **Public GitHub repository**: `https://github.com/Moemen999/dental-lab` (PUBLIC). Its `main` branch was published from a fresh orphan branch (`public-main`, one initial commit) so the private development history is not public.
- **Local branches**: `dental_case_management_system` keeps the full private history as a local backup. **Never push it.** Publish only from `public-main` to `origin/main`.
- **Remote Policy**: `origin` is the only remote. Do not push anywhere else or add other remotes unless explicitly instructed. Everything pushed is public: no secrets, no real patient data, no personal emails (commit with the GitHub noreply address).

---

## 2. Project Summary

The CMS is used by **Dolphin Orthodontic Lab** (معمل دولفين لتقويم الأسنان), an **orthodontic** lab. It tracks each physical case (appliances, retainers, aligners, etc.) from collection at the dental clinic by a field representative until the finished work is returned to the dentist.

### Lab-specific decisions
- **Work types are owner-managed** (`work_types` table, migration 005, page `/work-types` "أنواع الشغل"). Nothing is hardcoded or seeded: the owner enters the lab's orthodontic types. Registration lists only active types; types are deactivated, never deleted. `cases.case_type` is a text snapshot of the type name, so renaming a type does not change old cases, and legacy prosthetic values from before 005 (e.g. `Crown`) still display via their old labels.
- **Assistant technicians (مساعد فني)** use the existing `technician` role. There is no separate role.
- **Lab identity**:
  - Files: `public/branding/logo.jpg` (original artwork, never edit or redraw) and `public/branding/logo-panel.jpg` (same artwork cropped to its content and resized only).
  - The logo is gold on dark teal: show it ONLY on a dark teal panel (`bg-brand-teal`), as in the login hero and sidebar header. Never place it on white.
  - Theme tokens in `src/index.css` (`@theme static`), sampled from the logo: `--color-brand-teal #063f4a` (also `--primary`/`--ring`), `--color-brand-teal-hover #0a5563`, `--color-brand-teal-50 #e6f0f2`, `--color-brand-gold #f4d88f`, `--color-brand-red #cc3136` (also `--destructive`), `--color-brand-red-hover #a8282c`.
  - Contrast (WCAG AA): gold text only on teal (8.3:1). Never gold on white/light backgrounds (1.4:1). Red on teal is 2.2:1, so red is a decorative accent there, never text.
  - Lab name "معمل دولفين لتقويم الأسنان" = `common.app.name` / `common.app.title` (login, sidebar, `<title>`).
  - No favicon yet: the dolphin mark cannot be cropped cleanly from the artwork (the default `public/favicon.svg` is still in place).

### Fundamental Business Invariants:
1. **Independent Case Traceability**: Every dental case has its own unique record and server-generated case number (`CASE-YYYYMM-NNNNN`). A delivery batch is a transfer grouping, **not** a case. Multiple cases in a delivery batch retain independent technician assignments, priorities, due dates, and statuses.
2. **Database-Enforced State Machine**: Transitions between case statuses are validated at the PostgreSQL trigger level (`trg_validate_case_status`). Direct or unauthorized client updates to `current_status` are rejected.
3. **Discrete Physical Handoffs**: A technician finishing work (`awaiting_reception_receipt`) does **not** count as reception receiving it (`received_by_reception`). Physical transfer points require distinct actor confirmations.
4. **No External Dentist Accounts**: External clinics and doctors are operational reference records (`dentists` table) recorded by staff. They do not log in.
5. **Zero Paid Services**: Architected to operate within free service tiers (Supabase free tier + Vercel/Netlify free tier).

---

## 3. Technology Stack

- **Frontend**: React 19, TypeScript (strict mode), Vite 8
- **Styling**: Tailwind CSS v4 (using `@tailwindcss/vite` and CSS custom property design tokens in `src/index.css`)
- **Icons & Notifications**: Lucide React, Sonner
- **State Management & Fetching**: TanStack Query v5 (React Query)
- **Forms & Validation**: React Hook Form, Zod
- **Routing**: React Router v7 (`BrowserRouter`, `Routes`, `ProtectedRoute`, `AppLayout`)
- **Database & Auth**: Supabase PostgreSQL 15+, Supabase Auth (JWT), Row Level Security (RLS)
- **Serverless Edge Functions**: Supabase Edge Functions (Deno runtime, located in `supabase/functions/manage-users`)
- **Testing**: Vitest 5.0.4 + JSDOM + `@testing-library/react` + `@testing-library/jest-dom`

---

## 4. Exact Commands

All commands run from the project root (`E:\dental-lab`):

```bash
# Install dependencies
npm install

# Run automated tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run real-database security tests only (PGlite runs supabase/migrations)
npm run test:db

# Prove the security tests fail without a migration (bash syntax)
DB_MIGRATIONS_EXCLUDE=003 npm run test:db

# Start local Vite development server (http://localhost:5173)
npm run dev

# Preview every page WITHOUT Supabase, using fake data (http://localhost:5174/?as=owner)
# roles: ?as=owner | receptionist | technician | representative; ?fail=1 previews a DB error
npm run dev:mock

# Compile TypeScript and build production bundle
npm run build

# Preview production build locally
npm run preview

# Automatic encrypted backup to Google Drive (lab PC, owner guide: docs/BACKUP_GUIDE_AR.md)
# Setup (owner, once): scripts\backup\setup-backup.cmd
# Private files live in %LOCALAPPDATA%\DolphinBackup (never in the repo); age private key stays with the owner.
npm.cmd run test:backup     # unit + end-to-end test on a temporary local PostgreSQL with fake data

# Database manual backups (free tier off-site recovery)
# Windows PowerShell:
.\scripts\backup.ps1 -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Linux / macOS:
./scripts/backup.sh "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Database restore:
# Windows PowerShell:
.\scripts\restore.ps1 -BackupFile "./backups/backup.sql" -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
```

---

## 5. Folder Structure

```
dental_case_management_system/
├── .env.example                     # Environment variable placeholders
├── .gitignore                       # Standard Git exclusions (node_modules, dist, .env)
├── CLAUDE.md                        # This developer guide
├── README.md                        # High-level overview
├── index.html                       # Single-page app root entrypoint
├── package.json                     # Dependencies, scripts, and engine configs
├── tsconfig.json                    # Monorepo TS configuration references
├── tsconfig.app.json                # Main application TS config (strict mode, path alias @/*)
├── tsconfig.node.json               # Node tooling TS config
├── vite.config.ts                   # Vite bundler, path aliases, Tailwind v4 plugin
├── vitest.config.ts                 # Vitest testing configuration with JSDOM
│
├── docs/                            # Comprehensive documentation & specifications
│   ├── AGENT_SKILLS.md              # Agent skills discovery and evaluation report
│   ├── ARCHITECTURE.md              # 3-tier system architecture and security trust boundaries
│   ├── CASE_WORKFLOW.md             # Case lifecycle, handoffs, and state diagram
│   ├── DATABASE_SCHEMA.md           # Tables, columns, constraints, and data dictionary
│   ├── DEPLOYMENT.md                # Setup, initial Owner provisioning, and free-tier limits
│   ├── ERD.md                       # Mermaid Entity-Relationship Diagram
│   ├── FINAL_HANDOVER_REPORT.md     # Markdown technical handover document
│   ├── FINAL_HANDOVER_REPORT.pdf    # A4 printable PDF handover report (291 KB)
│   ├── FINAL_HANDOVER_REPORT.html   # HTML print template for PDF generation
│   ├── IMPLEMENTATION_PLAN.md       # Master engineering implementation plan
│   ├── PERMISSIONS_MATRIX.md        # Complete RBAC permissions matrix across all 4 roles
│   ├── PROJECT_SPECIFICATION.md     # Business requirements and acceptance criteria
│   ├── SECURITY.md                  # OWASP security architecture and IDOR defenses
│   ├── SECURITY_CHECKLIST.md        # Implemented security controls checklist
│   └── TEST_PLAN.md                 # Test plan and automated suite results
│
├── public/                          # Static assets served at root
│
├── scripts/                         # Operational utilities and backup automation
│   ├── backup.ps1                   # PowerShell PostgreSQL backup script (pg_dump)
│   ├── backup.sh                    # POSIX Bash backup script
│   ├── restore.ps1                  # PowerShell PostgreSQL restore script
│   ├── restore.sh                   # POSIX Bash restore script
│   ├── seed_demo_data.sql           # Sample clinics, batches, and cases for testing
│   ├── serve-report.mjs             # Standalone local HTTP server for file downloads
│   └── build-downloader.mjs         # Generator for standalone offline downloader
│
├── src/                             # Application source code
│   ├── main.tsx                     # React root mount (`StrictMode`, `index.css`)
│   ├── App.tsx                      # Root component with routing, QueryClient, AuthProvider
│   ├── index.css                    # Tailwind CSS v4 setup and design system tokens
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx        # Email/password authentication form
│   │   │   └── ProtectedRoute.tsx   # Declarative route guard (auth & role verification)
│   │   ├── layout/
│   │   │   └── AppLayout.tsx        # Responsive sidebar, navigation, role banner, sign-out
│   │   └── ui/                      # Modular accessible UI components
│   │       ├── Badge.tsx            # Variant badge component
│   │       ├── Button.tsx           # Button with variants, sizes, and loading spinner
│   │       ├── Card.tsx             # Card, CardHeader, CardTitle, CardContent
│   │       ├── Dialog.tsx           # Accessible modal dialog: focus moves in, Tab trapped, Escape closes, focus restored
│   │       ├── EmptyState.tsx       # Placeholder card for empty datasets
│   │       ├── Input.tsx            # Form text input with label and error state
│   │       ├── Pagination.tsx       # Pagination navigation controls
│   │       ├── Select.tsx           # Native select dropdown wrapper
│   │       ├── Spinner.tsx          # SVG animated loading spinner
│   │       ├── StatusBadge.tsx      # Specialized color-coded badges for 14 case statuses
│   │       ├── Table.tsx            # Accessible table components
│   │       └── Textarea.tsx         # Multi-line text inputs
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx          # Supabase auth session, user profile, active check
│   │
│   ├── hooks/
│   │   └── useSupabase.ts           # React Query hooks for Cases, Batches, Dentists, Profiles, Events, Audits
│   │
│   ├── lib/
│   │   ├── supabase.ts              # Supabase browser client (`createClient`)
│   │   └── utils.ts                 # `cn()` clsx merger, date formatters, `isOverdue()`
│   │
│   ├── pages/
│   │   ├── DashboardRouter.tsx      # Directs '/' to appropriate dashboard based on user role
│   │   ├── OwnerDashboard.tsx       # Macro KPIs, workflow distribution, overdue cases, recent cases
│   │   ├── ReceptionDashboard.tsx   # Front-desk intake, tech assignment, receipt staging
│   │   ├── TechnicianDashboard.tsx  # Personal workbench, clinical specs, start work, handoff
│   │   ├── RepresentativeDashboard.tsx # Field logistics, delivery batches, clinic receipt confirmation
│   │   ├── CasesPage.tsx            # Global case catalog with search, filters, pagination
│   │   ├── CaseDetailPage.tsx       # Case specifications, dynamic status buttons, timeline
│   │   ├── CaseRegistrationPage.tsx # Validated registration form with auto-generated case numbers
│   │   ├── BatchesPage.tsx          # Intake & return delivery batches with discrepancy checks
│   │   ├── DentistsPage.tsx         # External dental clinics directory
│   │   ├── EmployeesPage.tsx        # Staff administration, invite modal, deactivation reassignment
│   │   └── AuditLogsPage.tsx        # Administrative security audit trail
│   │
│   ├── test/                        # Vitest suites (616 passing; src/test/db = real migrations on PGlite)
│   │   ├── setup.ts                 # Test setup importing `@testing-library/jest-dom`
│   │   ├── caseNumber.test.ts       # Monthly counter format, rollover, >99k scaling, concurrency
│   │   ├── stateMachine.test.ts     # State progression, terminal states, hold & rework paths
│   │   ├── permissions.test.ts      # Role authorization, negative tests, IDOR prevention
│   │   ├── handoffs.test.ts         # Multi-case batch isolation, discrepancy handling
│   │   ├── employeeAdmin.test.ts    # Last active owner protection, deactivation reassignment
│   │   └── utils.test.ts            # Date formatting and overdue calculations
│   │
│   └── types/
│       └── database.ts              # Complete TypeScript definitions matching database schema
│
└── supabase/                        # Database migrations & Edge Functions
    ├── migrations/
    │   ├── 001_initial_schema.sql   # Custom types, tables, constraints, sequences, triggers, RLS
    │   └── 002_owner_protections.sql# Owner protection trigger, deactivation checks & reassignment
    └── functions/
        └── manage-users/            # Privileged Edge Function for employee invites & session revocation
            └── index.ts
```

---

## 6. Supabase Migrations & Execution Order

To set up the database in Supabase (or a clean PostgreSQL instance):

1. **Migration 1**: `supabase/migrations/001_initial_schema.sql`
   - Enables `uuid-ossp` and `pgcrypto`.
   - Creates enums: `app_role`, `account_status`, `case_status`, `batch_type`, `batch_status`, `case_event_type`, `audit_action`.
   - Creates tables: `profiles`, `dentists`, `monthly_case_counters`, `delivery_batches`, `cases`, `batch_cases`, `case_events`, `technician_assignments`, `audit_logs`.
   - Creates function `generate_case_number()`: atomic upsert on `monthly_case_counters` with row-lock (`SELECT FOR UPDATE`), formatting `CASE-YYYYMM-NNNNN`.
   - Creates trigger `trg_validate_case_status`: validates all transitions against server state machine.
   - Creates function `record_case_event()`: safely creates immutable event records.
   - Configures Row Level Security (RLS) on all tables.
   - Revokes `UPDATE` and `DELETE` on `case_events` and `audit_logs`.

2. **Migration 2**: `supabase/migrations/002_owner_protections.sql`
   - Creates trigger `protect_last_active_owner`: aborts any operation that would deactivate, demote, or delete the last active Owner.
   - Creates function `get_employee_outstanding_work()`: queries active assigned cases and open batches for an employee before deactivation.
   - Creates stored procedure `reassign_and_deactivate_technician()`: atomically reassigns all active cases to a replacement technician, creates case events, logs audit trail, and marks the profile inactive.

3. **Migration 3**: `supabase/migrations/003_security_hardening.sql`
   - Fixes 8 verified privilege holes (see `docs/KNOWN_ISSUES.md`).
   - Re-creates every SECURITY DEFINER function with NULL-safe checks and `search_path = ''`; revokes EXECUTE from PUBLIC/anon.
   - Adds `transition_case_status()` RPC; status events are written by trigger `trg_log_case_status_change`.
   - Clients may only add `note_added` events; direct INSERT on `case_events` is revoked.
   - Errors carry a stable key in `HINT` (e.g. `err.case.invalid_transition`) for translation.

4. **Migration 4**: `supabase/migrations/004_permission_fixes.sql`
   - Representatives: create only open batches for themselves; edit only notes / expected_count / discrepancy_notes on their own open batches.
   - Receptionists cannot set in_progress, completed, awaiting_reception_receipt, with_representative, delivered.

5. **Migration 5**: `supabase/migrations/005_work_types.sql`
   - `work_types` (owner insert/update only; staff read active; no delete; anon none). Changes audited in `audit_logs` (`settings_changed`, `target_type = 'work_type'`).
   - New or changed `cases.case_type` from the app must match an active work type (`err.case.invalid_work_type`).

6. **Migrations 6–9** (KNOWN_ISSUES #3–#6, tests in `src/test/db/openIssues.test.ts`):
   - `006`: a case's technician can only be set to an active technician (UPDATE too).
   - `007`: `technician_assignments` is written only by trigger `trg_sync_technician_assignment` (assigned_by = caller, same transaction). Clients only read it; to assign, update `cases.assigned_technician_id`.
   - `008`: owner may move `in_progress` → `awaiting_assignment` only while removing the technician (deactivation without replacement).
   - `009`: case INSERT writes a `created` event and the assignment row.
   - `010` (#8): representatives add cases only to their own open batches; `added_by` and `actual_count` are set by the database.
   - `011` (#11): case search goes through `search_cases(p_query)` (parameter, literal match, RLS applies). Never build PostgREST `.or()` filters from user text.
   - `012` (#9): case numbers use the Africa/Cairo month (`private.case_number_month`). Existing numbers are not changed.
   - `013`: late / due-today cases via `get_late_cases()` and `get_late_case_counts()` (owner + receptionist only, Africa/Cairo date via `private.cairo_date`). Page `/late-cases` "المتأخرات" with wa.me links (`src/lib/whatsapp.ts`); nothing is sent automatically.
   - `014`: `cases.upper_jaw` / `lower_jaw` (boolean). Trigger `trg_validate_case_jaws` requires at least one on every app INSERT and whenever a jaw changes; old rows (both NULL) stay editable. `shade` / `tooth_number` are kept untouched and shown read-only as old data.
   - `015`: money module (owner + receptionist only; invisible to technician, representative, anon and inactive users): `price_list`, `dentist_discounts`, `case_charges` (auto price snapshot per case, owner-only manual edit, counts only when delivered), append-only `payments` (corrections = one reversal of exactly minus the original), optional owner-set `dentist_opening_balances`; RPCs `get_dentist_statement`, `get_dentist_balances`, `get_case_balance`, `get_owner_dashboard_stats` (one call for the owner dashboard, KNOWN_ISSUES #16). Old delivered cases are never auto-charged.
   - `016`: an opening balance cannot be 0 or dated after today (Cairo). `017`: statement lines carry `is_reversed`.
   - Money pages: `/pricing` "الأسعار" (owner), `/accounts` "الحسابات" and `/accounts/:dentistId` statement with print view (owner + receptionist); case page "الحساب" card. Amounts are numeric in the DB and shown with `formatMoney()`; the browser never does money arithmetic. Payment ids are generated in the dialog so a double submit cannot create two payments.

7. **Optional Demo Seed**: `scripts/seed_demo_data.sql`
   - Inserts realistic clinics (Apex Dental Arts, Metropolitan Smiles, etc.) and sample cases in various workflow states for immediate testing.

8. **Initial Owner Creation Procedure**:
   - Create user in Supabase **Authentication > Users** (e.g. `owner@dentallab.com`).
   - Run in SQL Editor:
     ```sql
     UPDATE profiles SET role = 'owner', status = 'active' WHERE email = 'owner@dentallab.com';
     ```

---

## 7. The 4 Roles & Permission Rules

| Role | View Scope | Mutations Allowed | Prohibited Operations |
| :--- | :--- | :--- | :--- |
| **`owner`** | Full visibility across all cases, batches, clinics, employees, and audit logs. | Case registration, assignment, all status transitions, employee invite/edit/deactivation, clinic creation. | Cannot deactivate self if the sole active Owner (`protect_last_active_owner` trigger). Cannot delete case events. |
| **`receptionist`** | Full cases, batches, dentists. | Case registration, intake batch confirmation, technician assignment, receipt acknowledgement (`received_by_reception`), staging for delivery. | Cannot manage employee accounts, modify administrative roles, or view system audit logs. |
| **`technician`** (also used for assistant technicians / مساعد فني) | **Assigned cases only** (enforced by RLS `assigned_technician_id = auth.uid()`). | Acknowledge receipt, mark `in_progress`, mark `completed`, submit to reception (`awaiting_reception_receipt`), put on hold. | Cannot see other technicians' cases (IDOR barrier). Cannot register cases, release to representative, or mark delivered. |
| **`representative`** | Logistics batches, deliveries, all cases. | Create intake batches, accept return batches (`with_representative`), confirm clinic delivery (`delivered`) with notes. | Cannot register cases, assign technicians, alter clinical specifications, or manage staff. |

---

## 8. The 14 Case Statuses & State Machine

```
[intake_pending] ──> [registered] ──> [awaiting_assignment] ──> [assigned]
                                                                    │
┌───────────────────────────────┐                                   ▼
│ [on_hold] <──> [in_progress]  │                           [in_progress]
└───────────────────────────────┘                                   │
                                                                    ▼
                                                               [completed]
                                                                    │
                                                                    ▼
                                                       [awaiting_reception_receipt]
                                                                    │
                                                                    ▼
                                                         [received_by_reception]
                                                                    │
                                                                    ▼
                                                    [awaiting_representative_pickup]
                                                                    │
                                                                    ▼
                                                         [with_representative]
                                                                    │
                                                                    ▼
                                                               [delivered] (Terminal)
```

### Full Enum Definition:
1. `intake_pending`: Physical box arrived at reception; details pending entry.
2. `registered`: Details recorded; awaiting assignment queue.
3. `awaiting_assignment`: In queue for technician allocation.
4. `assigned`: Assigned to a specific technician; pending work start.
5. `in_progress`: Fabrication actively underway in the laboratory.
6. `completed`: Fabrication completed by technician.
7. `awaiting_reception_receipt`: Finished case in transit to reception QC desk.
8. `received_by_reception`: Reception verified and inspected the physical item.
9. `awaiting_representative_pickup`: Staged in outbound delivery area.
10. `with_representative`: In transit with field representative to external clinic.
11. `delivered`: Confirmed delivered to clinic (terminal status).
12. `on_hold`: Work paused (clinical query, impression discrepancy, shade query).
13. `rework_required`: Quality control flagged item for adjustment or rebuild.
14. `cancelled`: Cancelled by Owner or Receptionist (terminal status).

---

## 9. Coding Conventions & Architectural Guidelines

- **TypeScript Strictness**: `strict: true` and `verbatimModuleSyntax: true` are enabled in `tsconfig.app.json`. Distinguish type imports (`import type { ... }`) from runtime imports.
- **Path Aliases**: Always use `@/` for internal project imports (e.g. `import { Button } from '@/components/ui/Button'`).
- **Styling**: Use Tailwind CSS utility classes. For component variants, use `class-variance-authority` (cva) and `cn()` from `@/lib/utils`.
- **Database Access**: All client data operations go through `supabase` client in `@/lib/supabase`. Use TanStack Query hooks in `@/hooks/useSupabase.ts` to ensure automated cache invalidation upon mutation.
- **Server-Side Security**: Never rely on client-side checks for data security. Every state change and data access rule must be enforced via Supabase RLS and database triggers.
- **Arabic UI (RTL)**: Arabic is the only UI language (`<html lang="ar" dir="rtl">`). Never hardcode user-facing text: add it to `src/i18n/ar/<page>.ts` and use `t('key')` (or `tx()` for React nodes). Show errors with `toast.error(errorMessage(err))` from `@/i18n/errors`; new DB errors need `USING HINT = 'err.<area>.<name>'` plus an entry in `src/i18n/ar/errors.ts`. Use logical Tailwind classes (`ms/me/ps/pe/start/end/text-start`), wrap case numbers/phones/emails in `<Ltr>`/`<CaseNumber>` and names in `<AutoDir>`. Dates use `formatDate()` (ar-EG, Gregorian, Western digits). `src/test/i18n` fails on missing keys or literal English.
- **Zero Secrets in Git**: Never hardcode API keys, service role keys, or database credentials.

---

## 10. Current Status — What Is Done

- [x] Full database schema migration with tables, enums, triggers, and sequences (`001_initial_schema.sql`).
- [x] Owner account protection trigger and technician reassignment procedure (`002_owner_protections.sql`).
- [x] Privileged Edge Function for Owner user management (`manage-users/index.ts`).
- [x] Atomic monthly case numbering (`CASE-YYYYMM-NNNNN`) with month rollover and >99k handling.
- [x] Complete state machine with database-level transition enforcement.
- [x] Row Level Security (RLS) configured on every table with least-privilege grants.
- [x] Append-only operational event log (`case_events`) and administrative audit log (`audit_logs`).
- [x] Role-adaptive navigation and dashboards for Owner, Receptionist, Technician, and Representative.
- [x] Case registration form with doctor selection, clinical specs (upper/lower jaw, due date; shade and tooth number kept read-only as old data since 014), and validation.
- [x] Interactive case detail page with clinical timeline and dynamic valid status transition controls.
- [x] Phone layout: every list page shows a card list below `md` (`src/components/ui/ResponsiveList.tsx`, 44px actions, `role="list"`), tables from `md` up.
- [x] Delivery batch creation (intake & return) with box count discrepancy tracking.
- [x] Staff management page with employee invite modal, role assignment, and active cases inspection before deactivation.
- [x] 616 automated tests passing (34 files), incl. 290 real-database tests in `src/test/db` on PGlite; backup scripts: `npm.cmd run test:backup`.
- [x] Clean production build with zero TypeScript or Vite errors (558 KB total bundle).
- [x] Full project documentation in `docs/` and standalone PDF handover document.
- [x] Offline database backup scripts in PowerShell (`scripts/backup.ps1`) and Bash (`scripts/backup.sh`).

---

## 11. Known Gaps to Verify

Before moving to production or extending features, verify the following items:

1. **Free-Tier Supabase Limitations**:
   - The Supabase free-tier project pauses after 7 days of inactivity.
   - The free tier has no managed backups. Routine manual backups must be taken via `scripts/backup.ps1` (PowerShell) or `scripts/backup.sh` (Bash).
2. **Automated Test Coverage Scope**:
   - `src/test/db/` runs the real migrations on PGlite (in-process Postgres) with a Supabase-like auth stub and tests RLS, triggers and SECURITY DEFINER functions.
   - The older suites in `src/test/*.test.ts` re-implement rules inside the tests; treat `src/test/db/` as the source of truth.
   - Not covered: the `manage-users` Edge Function, Supabase Auth itself, and Storage. No Docker/local Supabase is used.
   - Open issues are tracked in `docs/KNOWN_ISSUES.md`.
3. **SECURITY DEFINER Functions Review**:
   - Reviewed and hardened in `003_security_hardening.sql` (NULL-safe checks, `search_path = ''`, EXECUTE revoked from PUBLIC/anon). Any NEW definer function must follow the same pattern and get a test in `src/test/db/`.
4. **Localization & RTL**:
   - Done: full Arabic RTL UI (see coding conventions). Medical/lab terms are pending review by the lab owner.
5. **Missing Features to Implement**:
   - ~~**Invoicing and billing**~~: done in 015-017 (prices, discounts, payments, statements, opening balances). No VAT / e-invoicing (owner decision).
   - ~~**Late-case alerts**~~: done in 013 (page "المتأخرات", dashboard count, wa.me links). Automatic sending is intentionally not done (no paid API).
   - **QR or barcode tracking**: Barcode generation and scanning for physical case boxes and job cards.
   - **QC checklists**: Multi-point inspection checklists before packaging and release.
   - **Lab performance reports**: Technician productivity, turnaround times, and remake rate analytics.
   - **File attachments**: In-app uploading and viewing of digital CAD/CAM scans (STL files) and photos.

---

## 12. Decisions Already Made (ADRs)

1. **Relational PostgreSQL via Supabase**: Chosen over NoSQL because dental cases have strict relational integrity with delivery batches, technician assignments, and immutable audit logs.
2. **Monthly Counter vs. Global Sequence**: A single global sequence does not reset monthly. We implemented an atomic monthly counter table (`monthly_case_counters`) using `SELECT FOR UPDATE` to guarantee `CASE-YYYYMM-NNNNN` formatting with zero collisions under concurrency.
3. **Trigger-Based State Machine**: Status transitions cannot be entrusted to client requests. Trigger `trg_validate_case_status` evaluates role, assignment ownership, and valid state transitions inside the database transaction.
4. **Append-Only Event Logs**: Both `case_events` and `audit_logs` have `REVOKE UPDATE, DELETE` applied to guarantee non-repudiation for clinical audits.
5. **No Self-Registration**: Public signup is disabled; only the laboratory Owner can provision new staff accounts.
