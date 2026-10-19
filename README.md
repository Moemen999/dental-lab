# Dental Laboratory Case Management System (CMS)

A production-ready, full-stack web application designed for dental laboratories to manage the operational lifecycle of custom prosthetics and dental cases — from representative intake handoffs through technician fabrication, quality control, batch packaging, and clinic delivery confirmation.

Built to operate continuously within **free-tier service quotas** (Supabase + Vercel/Netlify) without commercial subscription dependencies.

---

## Key Features

- **Unique Case Numbering (`CASE-YYYYMM-NNNNN`)**: Transaction-safe, atomic monthly sequence that restarts each month and seamlessly scales past 99,999 without truncation or collision.
- **Dedicated Role-Based Workspaces**:
  - **Owner**: Executive KPI metrics, case pipeline, staff administration, audit inspection.
  - **Receptionist**: Intake registration, box count discrepancy tracking, technician assignment, delivery staging.
  - **Technician**: Personal workbench showing assigned workload, clinical specs, teeth charts, shades, and handoffs.
  - **Representative**: Field logistics dashboard, delivery batches, clinic receipt confirmation with notes.
- **Database-Enforced State Machine**: Valid status transitions enforced in PostgreSQL via triggers; client bypasses are strictly prevented.
- **Physical Handoff Separation**: Technician completion is distinguished from reception's physical receipt; multi-case batches maintain independent item traceability.
- **Row-Level Security (RLS)**: Enforced across every database table; strict IDOR protection between technicians.
- **Owner Account Safeguards**: Invariant database protection preventing the deactivation, demotion, or deletion of the last active Owner.
- **Case Reassignment on Deactivation**: Deactivating a departing technician prompts inspection and atomic reassignment of all open cases.
- **Append-Only Event & Audit Logs**: `case_events` and `audit_logs` tables have `UPDATE` and `DELETE` revoked at the database permission level.

---

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Sonner
- **State Management & Data Fetching**: TanStack Query v5
- **Routing**: React Router v7
- **Database & Auth**: Supabase PostgreSQL 15+, Supabase Auth, Row Level Security (RLS)
- **Privileged Operations**: Supabase Edge Functions (Deno runtime)
- **Testing**: Vitest 5.0.4 + JSDOM + Testing Library (28 automated tests passing)

---

## Getting Started Locally

### 1. Prerequisites
- Node.js 18+ (verified on Node.js 24)
- npm 9+

### 2. Installation
```bash
# Clone the repository
git clone <repository-url>
cd dental_case_management_system

# Install dependencies
npm install
```

### 3. Environment Setup
Copy the sample environment file and add your Supabase credentials:
```bash
cp .env.example .env
```
Edit `.env`:
```ini
VITE_SUPABASE_URL=https://[YOUR_PROJECT_ID].supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Database Setup
1. In the Supabase Dashboard, open the **SQL Editor**.
2. Run `supabase/migrations/001_initial_schema.sql` (Creates tables, triggers, functions, and RLS).
3. Run `supabase/migrations/002_owner_protections.sql` (Adds owner guards & reassignment procedures).
4. *(Optional for demo)* Run `scripts/seed_demo_data.sql` to populate sample clinics and cases.

### 5. Running the Application
```bash
# Start development server
npm run dev

# Run automated test suite
npm test

# Build for production
npm run build
```

---

## Documentation Index

Comprehensive project documentation is available in the [`docs/`](./docs) directory:

- [Project Specification](./docs/PROJECT_SPECIFICATION.md) — Business requirements, actors, acceptance criteria.
- [System Architecture](./docs/ARCHITECTURE.md) — Trust boundaries, data flow, technology decisions.
- [Database Schema & Data Dictionary](./docs/DATABASE_SCHEMA.md) — Tables, columns, foreign keys, constraints.
- [Entity-Relationship Diagram (ERD)](./docs/ERD.md) — Mermaid ER diagram.
- [Permissions Matrix (RBAC)](./docs/PERMISSIONS_MATRIX.md) — Role capabilities, CRUD matrix, negative auth tests.
- [Case Workflow & State Machine](./docs/CASE_WORKFLOW.md) — State diagram, handoffs, permitted transitions.
- [Security Architecture](./docs/SECURITY.md) — OWASP threat model, RLS, IDOR defenses, secrets segregation.
- [Security Verification Checklist](./docs/SECURITY_CHECKLIST.md) — Verification checklist and evidence.
- [Agent Skills Report](./docs/AGENT_SKILLS.md) — Skills discovery, audit, and verification report.
- [Test Plan & Results](./docs/TEST_PLAN.md) — Automated test suite report (28/28 passing).
- [Deployment & Free-Tier Operations](./docs/DEPLOYMENT.md) — Setup, initial Owner provisioning, backups, quotas.

---

## Regular Database Backups

Because Supabase free tier does not include automated daily point-in-time recovery, execute the included backup script regularly:

**Windows PowerShell:**
```powershell
.\scripts\backup.ps1 -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
```

**Linux / macOS:**
```bash
./scripts/backup.sh "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
```
Backups are saved to `./backups/`.
