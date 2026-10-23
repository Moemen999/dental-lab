# Permissions Matrix — Role-Based Access Control (RBAC)

## 1. Overview
Access control is implemented in depth:
1. **Frontend**: Navigation links, action buttons, and route views adapt to the user's role.
2. **Server (Client API)**: Supabase RLS policies deny access by default and filter records on every query.
3. **Server (Database Functions & Triggers)**: State transitions and entity constraints are validated in PostgreSQL.
4. **Server (Edge Functions)**: High-privilege administrative actions (user creation, global session revocation, role changes) verify that caller is an active Owner.

---

## 2. Comprehensive Role Permissions Matrix

| Entity / Operation | Owner | Receptionist | Representative | Technician |
| :--- | :---: | :---: | :---: | :---: |
| **Cases** | | | | |
| View All Cases | ✅ Full | ✅ Full | ✅ Full | ❌ Assigned only |
| Register New Case | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Edit Clinical Specs | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Assign / Reassign Technician | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Advance to `in_progress` | ✅ Allowed | ❌ Denied | ❌ Denied | ✅ Assigned only |
| Advance to `completed` | ✅ Allowed | ❌ Denied | ❌ Denied | ✅ Assigned only |
| Submit to Reception (`awaiting_reception_receipt`) | ✅ Allowed | ❌ Denied | ❌ Denied | ✅ Assigned only |
| Acknowledge Receipt (`received_by_reception`) | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Release to Delivery (`awaiting_representative_pickup`) | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Pick Up Batch (`with_representative`) | ✅ Allowed | ❌ Denied | ✅ Allowed | ❌ Denied |
| Mark Delivered (`delivered`) | ✅ Allowed | ❌ Denied | ✅ Allowed | ❌ Denied |
| Put On Hold / Resume | ✅ Allowed | ✅ Allowed | ❌ Denied | ✅ Assigned only |
| Flag Rework Required | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Cancel Case | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Delete Case Record | ❌ Denied (Soft) | ❌ Denied | ❌ Denied | ❌ Denied |
| **Delivery Batches** | | | | |
| View Delivery Batches | ✅ Full | ✅ Full | ✅ Full | ❌ Denied |
| Create Intake Batch | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ Denied |
| Create Return Batch | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ Denied |
| Confirm Batch Receipt | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Log Box Discrepancies | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ Denied |
| **Dentists & External Clinics** | | | | |
| View Directory | ✅ Full | ✅ Full | ✅ Full | ❌ Read limited |
| Create New Clinic Record | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| Edit Clinic Details | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Case Events (History)** | | | | |
| View Chronological Events | ✅ Full | ✅ Full | ✅ Full | ✅ Assigned only |
| Add Internal Case Note | ✅ Allowed | ✅ Allowed | ❌ Denied | ✅ Assigned only |
| Edit Event History | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** |
| Delete Event History | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** |
| **Staff & Account Administration** | | | | |
| View Employee Directory | ✅ Full | ❌ Denied | ❌ Denied | ❌ Denied |
| Invite / Create Employee | ✅ Allowed | ❌ Denied | ❌ Denied | ❌ Denied |
| Change Employee Role | ✅ Allowed | ❌ Denied | ❌ Denied | ❌ Denied |
| Deactivate Staff Account | ✅ Allowed | ❌ Denied | ❌ Denied | ❌ Denied |
| Inspect Outstanding Work | ✅ Allowed | ❌ Denied | ❌ Denied | ❌ Denied |
| Trigger Password Reset | ✅ Allowed | ❌ Denied | ❌ Denied | ❌ Denied |
| **Audit Logs** | | | | |
| View Administrative Audit Trail | ✅ Full | ❌ Denied | ❌ Denied | ❌ Denied |
| Clear / Alter Audit Logs | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** |

---

## 3. Negative Authorization Controls

The following direct exploit scenarios are explicitly verified and rejected server-side:
1. **Direct Object Reference (IDOR)**:
   - A technician sending an update payload for a case assigned to another technician is rejected by RLS (`cases_update` policy) and by trigger `trg_validate_case_status`.
2. **Privilege Escalation**:
   - Direct `UPDATE profiles SET role = 'owner'` by non-owner roles is rejected by the `profiles_update` RLS policy which checks `get_user_role() = 'owner'`.
3. **Bypassing Physical Handoffs**:
   - A representative attempting to update a case directly from `assigned` to `delivered` is rejected by the database state machine trigger (`Invalid transition`).
4. **Deactivating the Last Owner**:
   - If an Owner attempts to deactivate or demote their own account, or if there is only one active Owner remaining, database trigger `protect_last_active_owner` aborts the transaction with an explicit exception.
5. **Tampering with Audit or History**:
   - Any SQL `UPDATE` or `DELETE` directed at `case_events` or `audit_logs` fails immediately because database permissions have been revoked (`REVOKE UPDATE, DELETE`).
6. **Reading or changing money as a non-finance role** (migration 015):
   - Technicians, representatives, inactive users and anon get no rows from `price_list`, `dentist_discounts`, `case_charges`, `payments`, and the money functions refuse them (`err.money.forbidden`). Payments cannot be edited or deleted by anyone (`REVOKE UPDATE, DELETE` plus triggers that also stop the database owner); corrections are new negative rows. A receptionist cannot move a delivered case's debt to another doctor (`err.case.delivered_dentist_locked`).

---

## 4. Pricing & Accounts (migration 015)

Money is never visible to technicians or representatives. Inactive accounts and anon get nothing.

| Entity / Operation | Owner | Receptionist | Representative | Technician |
| :--- | :---: | :---: | :---: | :---: |
| View price list / doctor discounts | ✅ | ✅ | ❌ | ❌ |
| Set price per work type | ✅ | ❌ | ❌ | ❌ |
| Set doctor discount | ✅ | ❌ | ❌ | ❌ |
| View a doctor's opening balance | ✅ | ✅ | ❌ | ❌ |
| Set / change / remove a doctor's opening balance | ✅ (audited) | ❌ | ❌ | ❌ |
| View a case's price (`case_charges`) | ✅ | ✅ | ❌ | ❌ |
| Change a case's price / discount | ✅ (becomes `manual`, audited) | ❌ | ❌ | ❌ |
| Change the doctor of a **delivered** case | ✅ (audited) | ❌ | ❌ | ❌ |
| Change the doctor of a case that has payments | ❌ | ❌ | ❌ | ❌ |
| Record a payment (per case or on account) | ✅ | ✅ | ❌ | ❌ |
| Reverse a payment (new negative row) | ✅ | ✅ | ❌ | ❌ |
| Edit / delete a payment | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** |
| Doctor statement, balances, case balance | ✅ | ✅ | ❌ | ❌ |
| Owner dashboard stats (`get_owner_dashboard_stats`) | ✅ | ❌ | ❌ | ❌ |

Server-side enforcement: RLS policies on the five money tables; column grant on `case_charges` (`list_price`, `discount_percent` only); `UPDATE`/`DELETE` revoked on `payments` and refused by triggers for every role, including the database owner; no write privileges for `service_role` on the money tables; role checks via `private.caller_has_role` inside the SECURITY DEFINER functions and triggers. Verified in `src/test/db/pricing.test.ts`.
