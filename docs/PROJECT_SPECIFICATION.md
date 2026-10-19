# Project Specification — Dental Laboratory Case Management System

## 1. Executive Summary & Purpose

The **Dental Laboratory Case Management System (CMS)** is a specialized, production-ready web application built to govern the operational lifecycle of custom dental prosthetics, restorations, and appliances.

The system tracks physical dental cases from the exact second they are brought to laboratory reception by field representatives through case registration, clinical technician processing, quality control check-in, batch returns, and final delivery confirmation back to external dental clinics.

---

## 2. Operating Roles & Actor Model

The system implements four distinct internal roles with strictly partitioned operational surfaces. **External clinics and dentists have NO system accounts**; their details are managed exclusively as operational reference entities by laboratory staff.

```
       [External Clinics & Dentists]
                    ▲
                    │ (Physical Cases & Prescription Slips)
                    ▼
          ┌───────────────────┐
          │  REPRESENTATIVE   │  (Logistics & Field Deliveries)
          └─────────┬─────────┘
                    │ (Intake Handoff Batches)
                    ▼
          ┌───────────────────┐
          │   RECEPTIONIST    │  (Intake, Registration, Tech Assignment, QC)
          └─────────┬─────────┘
                    │ (Assignment & Physical Trays)
                    ▼
          ┌───────────────────┐
          │    TECHNICIAN     │  (Production, Milling, Staining, Glazing)
          └─────────┬─────────┘
                    │ (Handoff Back to Reception)
                    ▼
          ┌───────────────────┐
          │       OWNER       │  (Supervision, User Administration, Audits)
          └───────────────────┘
```

### The 4 Application Roles:
1. **Owner / Super Admin**:
   - Laboratory owner and executive authority.
   - Access to macro KPIs, workload distributions, overdue monitors, and complete system audit trails.
   - Exclusive authority to create, invite, activate, deactivate, and reassign employee accounts.
   - Protected by database-level invariant: the last active Owner account cannot be deactivated, demoted, or deleted.

2. **Representative**:
   - Logistics field personnel responsible for collecting cases from dental clinics and delivering completed restorations.
   - Access to Representative Dispatch Dashboard.
   - Capability to record and confirm delivery batches (intake and return) and confirm clinic delivery handoffs with notes.

3. **Receptionist**:
   - Front-desk operations manager.
   - Responsible for receiving representative intake batches, verifying box counts, and logging physical receipts.
   - Captures detailed clinical case registrations (patient name/age, clinic, tooth numbers, shade guide, case type, target due dates).
   - Generates unique case records, assigns work to technicians, receives completed cases, and stages them for representative pickup.

4. **Technician**:
   - Production specialist (ceramist, prosthodontist, CAD/CAM designer).
   - Personal workbench showing only cases assigned to them.
   - Capabilities to acknowledge case receipt, mark work in progress, place on hold with reason, flag rework required, and complete cases back to reception.
   - Strict IDOR barrier: cannot view or alter another technician's work.

---

## 3. Core Business Rules

1. **Independent Case Traceability**:
   - Every dental case is an independent entity with a system-generated unique number (`CASE-YYYYMM-NNNNN`).
   - A delivery batch is a logistical transfer grouping, NOT a case. When a representative brings 10 physical boxes in one batch, 10 separate cases are registered and tracked through distinct technicians, due dates, and workflows.

2. **Database-Enforced State Machine**:
   - State transitions cannot be bypassed by client requests. Every status change triggers database-level validation verifying current status, target status, actor role, and assignment ownership.

3. **Physical Handoff Separation**:
   - A technician marking work completed is **not** equivalent to reception physically receiving the item.
   - Physical handoffs (Tech $\rightarrow$ Reception, Reception $\rightarrow$ Rep, Rep $\rightarrow$ Clinic) require discrete confirmation events with timestamped actor attribution.

4. **Immutable Audit & Event Logs**:
   - The `case_events` and `audit_logs` tables are append-only.
   - Database privileges explicitly `REVOKE UPDATE, DELETE` from authenticated and anonymous users.

5. **Patient Privacy**:
   - Patient records contain only essential clinical identifiers (Name, Age/DOB, Tooth, Shade, Rx).
   - No patient data is exposed via public pages, open endpoints, or client-side telemetry.

---

## 4. Acceptance Criteria Summary

| Workflow Requirement | Verification Method | Status |
| :--- | :--- | :--- |
| Monthly counter `CASE-YYYYMM-NNNNN` | Vitest atomic counter & rollover tests | Verified |
| Handling monthly count > 99,999 | Vitest counter padding test | Verified |
| State machine transition enforcement | Database trigger & Vitest state machine tests | Verified |
| IDOR prevention across technicians | Server-side role & assignment check tests | Verified |
| Last active Owner protection | Database trigger & unit tests | Verified |
| Technician deactivation with case reassignment | Stored function & EmployeesPage integration | Verified |
| Separate intake batches vs case tracking | Delivery batch test suite | Verified |
| Full build passing with TypeScript | Vite & TSC compilation check | 0 Errors |
