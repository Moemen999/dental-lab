# Dental Laboratory Case Management System — Final Handover Report

**Status**: Complete & Verified (29/29 Automated Tests Passed, 0 Build Errors)  
**Target**: Dental Laboratory Case Management System  
**Stack**: React 19 + TypeScript + Supabase (PostgreSQL 15+) + Tailwind CSS v4  
**Date**: October 2026  

---

## 1. Implemented Features & Operational Scope

### Core Case Lifecycle & State Machine
- **Atomic Monthly Case Numbering (`CASE-YYYYMM-NNNNN`)**:
  - Implemented in PostgreSQL via `generate_case_number()`.
  - Transaction-safe atomic counter restarting each month.
  - Row-locking (`SELECT FOR UPDATE`) prevents concurrent collisions.
  - Scales gracefully past 99,999 without truncation or recycling.
- **Independent Case Traceability**:
  - Every individual dental case retains a distinct record, unique case number, prescription specs, and history.
  - Delivery batches group transfers logistically without merging case records.
- **Database-Enforced State Machine**:
  - Enforced via PostgreSQL trigger `trg_validate_case_status` across all 14 statuses:
    `intake_pending` &rarr; `registered` &rarr; `awaiting_assignment` &rarr; `assigned` &rarr; `in_progress` &rarr; `completed` &rarr; `awaiting_reception_receipt` &rarr; `received_by_reception` &rarr; `awaiting_representative_pickup` &rarr; `with_representative` &rarr; `delivered`.
  - Supports exception paths: `on_hold`, `rework_required`, and `cancelled`.
- **Physical Handoff Separation**:
  - Technician completion is strictly distinguished from reception's physical receipt.
  - Reception staging is separated from representative collection and clinic delivery.
- **Immutable Audit & Event Logs**:
  - `case_events` and `audit_logs` tables are append-only.
  - `UPDATE` and `DELETE` privileges are explicitly revoked at the database level.

### Dedicated Role-Based Workspaces
- **Owner Dashboard (`/`)**: Executive KPI metric cards, case pipeline workflow counts, overdue alerts, recent cases table, and administrative audit monitoring.
- **Receptionist Dashboard (`/`)**: Front-desk check-in, unassigned queue, one-click technician assignment modal, receipt verification, and dispatch staging.
- **Technician Workbench (`/`)**: Personal workbench showing only assigned cases, tooth numbers, shade guide, start work, pause on hold with reason, and submit to reception.
- **Representative Logistics (`/` & `/deliveries`)**: Intake batch creation, manifest management, box count discrepancy reporting, and clinic delivery confirmation.
- **Case Management (`/cases` & `/cases/:id`)**: Search by case number or patient, status filters, pagination, assignment dialogs, interactive status transitions, and chronological event timelines.
- **Case Registration Form (`/cases/new`)**: Form capturing patient details, clinic/doctor references (with inline clinic creation), tooth notation, shade guide, due dates, and priority.
- **Staff Management (`/employees`)**: Owner portal for staff invites, role modification, active/inactive toggles, password reset dispatch, and automated inspection of active cases before deactivating technicians.
- **System Audit Log (`/audit`)**: Immutable security timeline inspecting all user management actions, role updates, and system events.

---

## 2. Technology Stack & Architecture Decisions

| Layer | Technology | Architectural Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19 + TypeScript | Strict compile-time type safety, component modularity, and high rendering performance. |
| **Build Tool & Bundler** | Vite 8 + `@tailwindcss/vite` | Sub-second HMR, optimized tree-shaking producing a 558 KB production bundle (161 KB gzipped). |
| **Styling & Design System** | Tailwind CSS v4 + Design Tokens | Accessible, responsive design system with zero runtime CSS overhead and unified color variables. |
| **State & Cache** | TanStack Query v5 | Automatic background refetching, query deduplication, and mutation cache invalidation. |
| **Routing & Guards** | React Router v7 | Declarative route protection (`ProtectedRoute`) and role-based entrypoints (`DashboardRouter`). |
| **Database & Auth** | Supabase (PostgreSQL 15+) | Full relational integrity, atomic sequence counters, Row-Level Security, zero server maintenance costs. |
| **Privileged Server Logic** | Supabase Edge Functions | Deno runtime for administrative operations requiring the service-role key (user provisioning, session revocation). |
| **Automated Testing** | Vitest 5.0.4 + JSDOM | Fast ESM test runner integrated with Vite path aliases; 29/29 tests pass cleanly. |

---

## 3. Database Schema & Tables

| Table Name | Primary / Foreign Keys | Purpose & Security Controls |
| :--- | :--- | :--- |
| `profiles` | PK: `id` (UUID), FK: `auth.users(id)` | Internal laboratory staff profiles. Stores role, status, email. Guarded by `protect_last_active_owner` trigger. |
| `dentists` | PK: `id` (UUID), FK: `created_by` | External dental clinics and practitioners. External reference entity (no system login). |
| `monthly_case_counters` | PK: `year_month` (TEXT) | Atomic monthly counter (YYYYMM). Updated via `SELECT FOR UPDATE` in `generate_case_number()`. Direct client access revoked. |
| `cases` | PK: `id` (UUID), UK: `case_number`, FK: `dentist_id`, `assigned_technician_id` | Principal case entity. Stores patient demographics, clinical tooth/shade specs, due date, and workflow state. Validated by transition trigger. |
| `delivery_batches` | PK: `id` (UUID), UK: `batch_reference`, FK: `representative_id` | Physical transfer batches. Tracks intake/return status, expected count vs. actual count, and discrepancy remarks. |
| `batch_cases` | PK: `id` (UUID), FK: `batch_id`, `case_id` | Many-to-many junction joining batches and individual cases. Ensures cases remain independently traceable. |
| `case_events` | PK: `id` (UUID), FK: `case_id`, `actor_id` | **IMMUTABLE** operational event log. Records every status transition, handoff, and internal note. UPDATE and DELETE revoked. |
| `technician_assignments` | PK: `id` (UUID), FK: `case_id`, `technician_id` | Historical assignment records. Tracks active technician, assignment timestamp, receipt acknowledgement, and reassignment reasons. |
| `audit_logs` | PK: `id` (UUID), FK: `actor_id` | **IMMUTABLE** administrative security log. Captures user provisioning, role adjustments, and deactivations. UPDATE and DELETE revoked. |

---

## 4. Permissions Matrix (RBAC)

| Action / Resource | Owner | Receptionist | Representative | Technician |
| :--- | :---: | :---: | :---: | :---: |
| **View All Cases** | Full | Full | Full | Assigned Only |
| **Register New Case & Clinic** | Allowed | Allowed | Denied | Denied |
| **Assign / Reassign Technician** | Allowed | Allowed | Denied | Denied |
| **Start Work / Mark Completed** | Allowed | Denied | Denied | Assigned Only |
| **Submit to Reception (Stage D)** | Allowed | Denied | Denied | Assigned Only |
| **Acknowledge Physical Receipt** | Allowed | Allowed | Denied | Denied |
| **Pick Up Return Batch (Stage E)**| Allowed | Denied | Allowed | Denied |
| **Confirm Clinic Delivery (Stage F)**| Allowed | Denied | Allowed | Denied |
| **Put On Hold / Request Rework** | Allowed | Allowed | Denied | Assigned Only |
| **Manage Employees & Permissions** | Allowed | Denied | Denied | Denied |
| **View System Security Audit Logs** | Allowed | Denied | Denied | Denied |
| **Modify / Delete Historical Events**| **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** |

---

## 5. Actual Build, Test & Security Results

### Automated Test Suite (Vitest 5.0.4)
```
 RUN  v5.0.4

 ✓ src/test/handoffs.test.ts (3 tests)
 ✓ src/test/caseNumber.test.ts (5 tests)
 ✓ src/test/stateMachine.test.ts (4 tests)
 ✓ src/test/employeeAdmin.test.ts (4 tests)
 ✓ src/test/permissions.test.ts (8 tests)
 ✓ src/test/utils.test.ts (5 tests)

 Test Files  6 passed (6)
      Tests  29 passed (29)
   Duration  1.64s
```

### Production Build Verification
```
> tsc -b && vite build
✓ 2041 modules transformed.
dist/index.html                             0.79 kB │ gzip:  0.39 kB
dist/assets/index-DT4Dbr8a.css             35.94 kB │ gzip:  7.74 kB
dist/assets/rolldown-runtime-CbXtAM7H.js    0.58 kB │ gzip:  0.36 kB
dist/assets/index-Wqh2Kh5S.js               0.95 kB │ gzip:  0.57 kB
dist/assets/query-DR6sRXM9.js              43.00 kB │ gzip: 13.02 kB
dist/assets/supabase-1yby8ldT.js          214.04 kB │ gzip: 55.06 kB
dist/assets/vendor-CotpznSL.js            264.82 kB │ gzip: 84.68 kB
✓ built in 539ms
```

---

## 6. Local Execution Commands

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite
npm test

# 3. Start local development server (Vite on http://localhost:5173)
npm run dev

# 4. Compile for production
npm run build
```

---

## 7. Environment Variables Configuration

```ini
# Required in .env for frontend development:
VITE_SUPABASE_URL=https://[YOUR_PROJECT_ID].supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server-side ONLY (Supabase Edge Function secrets):
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

---

## 8. Database Migrations & Initial Setup

1. Open **Supabase Dashboard** &rarr; **SQL Editor**.
2. Run `supabase/migrations/001_initial_schema.sql` (Creates types, tables, constraints, sequences, triggers, and RLS).
3. Run `supabase/migrations/002_owner_protections.sql` (Adds owner guards & reassignment procedures).
4. *(Optional Demo Seed)* Run `scripts/seed_demo_data.sql` to populate sample dentists and initial cases.
5. **Initial Owner Creation**:
   - Go to **Authentication > Users** in Supabase &rarr; Click **"Add user"**.
   - Enter email (e.g. `owner@dentallab.com`), password, and check **"Auto Confirm User"**.
   - In SQL Editor, run:
     ```sql
     UPDATE profiles SET role = 'owner', status = 'active' WHERE email = 'owner@dentallab.com';
     ```

---

## 9. Deployment & Free-Tier Guarantees

- **Hosting**: Compatible with Vercel or Netlify free tiers (SPA configuration with rewrites to `/index.html`).
- **Database Storage**: Supabase free tier provides **500 MB** of database storage (~250,000 cases).
- **Inactivity Pausing**: Free tier pauses after 7 consecutive days of zero API requests. In daily operational use, pausing does not occur. If paused, unpausing takes 1–2 minutes from the dashboard.
- **Regular Backups**:
  - Windows: `.\scripts\backup.ps1 -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"`
  - Linux/macOS: `./scripts/backup.sh "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"`
