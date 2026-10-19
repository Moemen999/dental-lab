# Dental Laboratory Case Management System — Implementation Plan

## Architecture Decision Record

### Stack Selection
- **Frontend**: React 18 + TypeScript + Vite (fast dev, production-ready)
- **Backend**: Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage)
- **Styling**: Tailwind CSS 3 + shadcn/ui (accessible, consistent design system)
- **State Management**: TanStack Query (server state) + React Context (auth/UI state)
- **Routing**: React Router v6
- **Forms**: React Hook Form + Zod validation
- **Testing**: Vitest (unit) + Playwright (E2E) + Supabase local dev for integration
- **Deployment**: Vercel/Netlify free tier (frontend) + Supabase free tier (backend)

### Why Supabase?
- Free tier: 500MB database, 50K monthly active users, 1GB file storage
- Built-in Auth with email/password, role management via custom claims
- PostgreSQL with full SQL control, migrations, RLS
- Edge Functions for server-side business logic
- No separate server to deploy/maintain
- **Limitations**: Free tier has 2 projects, limited compute, may pause after 1 week inactivity

### Key Architecture Decisions
1. **Roles stored in `public.profiles` table** — Supabase Auth metadata + app-level role in profiles
2. **RLS enforces data access** — Every table has row-level security policies  
3. **Edge Functions for privileged operations** — User management, role changes, audit-sensitive ops use service_role key server-side only
4. **Case numbers use database sequence** — `CASE-YYYYMM-NNNNN` format, guaranteed unique via PostgreSQL sequence + unique constraint
5. **Immutable event log** — `case_events` table is append-only, no UPDATE/DELETE allowed
6. **State machine enforced server-side** — Valid transitions defined in database function, checked on every status change

## Database Schema Overview

### Core Tables
1. `profiles` — User profiles linked to auth.users (role, status, contact info)
2. `dentists` — External dentist/clinic records (not system users)
3. `delivery_batches` — Physical transfer groups (intake and return)
4. `cases` — Individual dental case records (the core entity)
5. `case_events` — Immutable status/handoff history log
6. `technician_assignments` — Case-to-technician assignment tracking
7. `batch_cases` — Many-to-many: which cases belong to which batch
8. `audit_logs` — Administrative audit trail (account changes, role changes, etc.)

### Case Statuses (State Machine)
```
INTAKE_PENDING → REGISTERED → AWAITING_ASSIGNMENT → ASSIGNED → 
IN_PROGRESS → COMPLETED → AWAITING_RECEPTION_RECEIPT → 
RECEIVED_BY_RECEPTION → AWAITING_REPRESENTATIVE_PICKUP → 
WITH_REPRESENTATIVE → DELIVERED

Exceptions: ON_HOLD, REWORK_REQUIRED, CANCELLED (from specific states)
```

## Implementation Phases

### Phase 1: Foundation ✏️
- [x] Create plan
- [ ] Initialize Vite + React + TypeScript project
- [ ] Install dependencies (Tailwind, shadcn/ui, supabase-js, etc.)
- [ ] Set up project structure
- [ ] Configure ESLint, TypeScript strict mode
- [ ] Create .env.example, .gitignore

### Phase 2: Database & Auth
- [ ] Create Supabase SQL migrations
- [ ] Define all tables, constraints, indexes
- [ ] Create RLS policies
- [ ] Create database functions (case number generation, state transitions)
- [ ] Set up Supabase client configuration
- [ ] Implement auth context and login flow
- [ ] Create Edge Functions for admin operations

### Phase 3: Core UI Components
- [ ] Set up shadcn/ui component library
- [ ] Create layout components (sidebar, header, navigation)
- [ ] Create role-based routing and guards
- [ ] Build shared components (data tables, status badges, forms)

### Phase 4: Case Management
- [ ] Case registration form
- [ ] Case detail page with timeline
- [ ] Case list with search/filter/pagination
- [ ] Delivery batch creation
- [ ] Technician assignment

### Phase 5: Workflow & Handoffs
- [ ] Handoff forms (rep→reception, tech→reception, reception→rep)
- [ ] Receipt confirmations
- [ ] Status transition enforcement
- [ ] Case event recording

### Phase 6: Dashboards
- [ ] Owner dashboard (stats, summaries, management)
- [ ] Receptionist dashboard
- [ ] Technician dashboard
- [ ] Representative dashboard
- [ ] User management (Owner only)

### Phase 7: Security & Testing
- [ ] Authorization tests
- [ ] RLS policy tests
- [ ] Workflow tests
- [ ] UI component tests
- [ ] Security review

### Phase 8: Documentation & Deployment
- [ ] All docs/ files
- [ ] README.md
- [ ] Deployment guide
- [ ] Final security checklist
