# Database Schema & Data Dictionary

## 1. Overview
The database uses PostgreSQL (managed via Supabase). Referential integrity is enforced strictly using foreign keys with `ON DELETE RESTRICT` or `ON DELETE CASCADE` where appropriate. RLS is enabled on every table.

---

## 2. Enumerated Types (Enums)

### `app_role`
- `owner`: Laboratory Owner / Super Admin
- `representative`: Logistics & Field Representative
- `receptionist`: Intake & Reception Operator
- `technician`: Production Specialist

### `account_status`
- `active`: Account in good standing
- `inactive`: Suspended / Departed employee (access blocked)
- `pending_invitation`: Invited but not yet verified

### `case_status`
- `intake_pending`: Physical box received, details pending registration
- `registered`: Details entered, awaiting assignment
- `awaiting_assignment`: In queue for technician assignment
- `assigned`: Assigned to technician, awaiting acknowledgement
- `in_progress`: Fabrication underway
- `completed`: Production completed by technician
- `awaiting_reception_receipt`: Submitted by technician, in transit to reception QC
- `received_by_reception`: Reception verified physical item
- `awaiting_representative_pickup`: Staged in outbound delivery area
- `with_representative`: Picked up by field representative
- `delivered`: Delivered to external clinic / dentist (terminal)
- `on_hold`: Work paused (clinical query or missing info)
- `rework_required`: Quality control flagged for adjustment or rebuild
- `cancelled`: Case cancelled by owner or receptionist (terminal)

### `case_event_type`
- `created`, `registered`, `assigned`, `reassigned`, `acknowledged`, `work_started`, `completed`, `submitted_to_reception`, `received_by_reception`, `released_to_representative`, `picked_up_by_representative`, `delivered`, `put_on_hold`, `resumed`, `rework_requested`, `cancelled`, `note_added`, `info_updated`, `batch_associated`

---

## 3. Data Tables

### `profiles`
Represents internal laboratory staff linked directly to `auth.users`.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, REFERENCES auth.users(id) | Auth user identifier |
| `email` | TEXT | NOT NULL, UNIQUE, CHECK format | Staff email address |
| `full_name` | TEXT | NOT NULL, CHECK length 2..200 | Display name |
| `role` | app_role | NOT NULL, DEFAULT 'technician' | Application permission role |
| `status` | account_status | NOT NULL, DEFAULT 'pending_invitation' | Operational access status |
| `phone` | TEXT | NULLABLE | Contact telephone |
| `avatar_url` | TEXT | NULLABLE | Profile picture URL |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |
| `deactivated_at`| TIMESTAMPTZ | NULLABLE | Deactivation timestamp |

### `dentists`
External dental practitioners and clinic accounts (not system users).
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `name` | TEXT | NOT NULL, CHECK length 2..200 | Dentist name (e.g. Dr. Clark) |
| `clinic_name` | TEXT | NULLABLE | Name of the dental clinic |
| `phone` | TEXT | NULLABLE | Clinic contact phone |
| `email` | TEXT | NULLABLE | Clinic contact email |
| `address` | TEXT | NULLABLE | Physical street address |
| `notes` | TEXT | NULLABLE | Doctor preferences / shade notes |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT true | Active status |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `created_by` | UUID | REFERENCES profiles(id) | Registering employee |

### `monthly_case_counters`
Atomic, transaction-safe counter used by `generate_case_number()`.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `year_month` | TEXT | PRIMARY KEY, CHECK ~ '^\d{6}$' | Year-month key (YYYYMM) |
| `last_number` | INTEGER | NOT NULL, DEFAULT 0, CHECK >= 0 | Last sequential number allocated |

### `delivery_batches`
Physical groupings of dental cases transported to or from clinics.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `batch_reference`| TEXT | NOT NULL, UNIQUE | Human readable code (e.g., BATCH-202610-INT-001) |
| `batch_type` | batch_type | NOT NULL ('intake' or 'return') | Transport direction |
| `status` | batch_status | NOT NULL, DEFAULT 'open' | 'open', 'closed', 'discrepancy' |
| `representative_id`| UUID | REFERENCES profiles(id) | Logistics representative |
| `receptionist_id`| UUID | REFERENCES profiles(id) | Front-desk recipient |
| `expected_count`| INTEGER | NULLABLE, CHECK >= 0 | Dispatched count |
| `actual_count` | INTEGER | DEFAULT 0, CHECK >= 0 | Physically verified count |
| `handoff_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Physical transfer timestamp |
| `confirmed_at` | TIMESTAMPTZ | NULLABLE | Reception verification timestamp |
| `notes` | TEXT | NULLABLE | Manifest or driver remarks |
| `discrepancy_notes`| TEXT | NULLABLE | Physical count mismatch details |

### `cases`
The principal operational entity representing an individual dental case.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique case UUID |
| `case_number` | TEXT | NOT NULL, UNIQUE | Format: `CASE-YYYYMM-NNNNN` |
| `patient_name` | TEXT | NOT NULL, CHECK length 1..300 | Patient full name |
| `patient_age` | INTEGER | NULLABLE, CHECK 0..150 | Patient age in years |
| `patient_dob` | DATE | NULLABLE | Patient birthdate |
| `dentist_id` | UUID | REFERENCES dentists(id) | Dentist foreign key |
| `dentist_name_text`| TEXT | NULLABLE | Fallback doctor name |
| `clinic_name_text` | TEXT | NULLABLE | Fallback clinic name |
| `case_type` | TEXT | NOT NULL | Crown, Bridge, Veneer, etc. |
| `upper_jaw` | BOOLEAN | NULLABLE (migration 014) | Work is for the upper jaw. NULL on cases registered before 014 |
| `lower_jaw` | BOOLEAN | NULLABLE (migration 014) | Work is for the lower jaw. NULL on cases registered before 014. A case registered from the app needs `upper_jaw` or `lower_jaw` = true (trigger `trg_validate_case_jaws`, hint `err.case.jaw_required`; checked on UPDATE only when a jaw changes; trusted sessions are not checked) |
| `tooth_number` | TEXT | NULLABLE | Legacy (before 014): tooth notation (e.g. 14, 21-23). No longer entered; shown read-only on old cases |
| `shade` | TEXT | NULLABLE | Legacy (before 014): shade guide code (A1, A2, etc.). No longer entered; shown read-only on old cases |
| `description` | TEXT | NULLABLE | Prescription description |
| `special_instructions`| TEXT | NULLABLE | Clinical guidance for ceramist |
| `current_status` | case_status | NOT NULL, DEFAULT 'registered' | Active workflow status |
| `priority` | TEXT | DEFAULT 'normal' (low, normal, high, urgent) | Production priority |
| `date_received` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Date case arrived at lab |
| `due_date` | DATE | NULLABLE | Target completion date |
| `completed_at` | TIMESTAMPTZ | NULLABLE | Production completion timestamp |
| `delivered_at` | TIMESTAMPTZ | NULLABLE | Final clinic delivery timestamp |
| `assigned_technician_id`| UUID | REFERENCES profiles(id) | Currently assigned technician |
| `assigned_at` | TIMESTAMPTZ | NULLABLE | Assignment timestamp |
| `intake_batch_id`| UUID | REFERENCES delivery_batches(id) | Arriving batch reference |
| `return_batch_id`| UUID | REFERENCES delivery_batches(id) | Outbound delivery batch |
| `registered_by` | UUID | REFERENCES profiles(id) | Receptionist actor |
| `notes` | TEXT | NULLABLE | Internal lab notes |

### `batch_cases`
Many-to-many junction joining batches and individual cases.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `batch_id` | UUID | NOT NULL, REFERENCES delivery_batches(id) | Batch reference |
| `case_id` | UUID | NOT NULL, REFERENCES cases(id) | Case reference |
| `added_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Association timestamp |
| `added_by` | UUID | REFERENCES profiles(id) | Associating employee |

### `case_events` (IMMUTABLE)
Append-only operational history recording all status transitions, handoffs, assignments, and notes.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `case_id` | UUID | NOT NULL, REFERENCES cases(id) | Target case |
| `event_type` | case_event_type | NOT NULL | Event classification |
| `previous_status`| case_status | NULLABLE | Starting state |
| `new_status` | case_status | NULLABLE | Resulting state |
| `actor_id` | UUID | NOT NULL, REFERENCES profiles(id) | Actor performing transition |
| `sender_id` | UUID | REFERENCES profiles(id) | Handoff releasing staff member |
| `receiver_id` | UUID | REFERENCES profiles(id) | Handoff receiving staff member |
| `notes` | TEXT | NULLABLE | Reason or transition notes |
| `metadata` | JSONB | DEFAULT '{}' | Additional context |
| `batch_id` | UUID | REFERENCES delivery_batches(id) | Associated batch if applicable |
| `assignment_id` | UUID | REFERENCES profiles(id) | Technician assigned |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Server-generated timestamp |

### `technician_assignments`
Historical record of technician assignments for each case.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `case_id` | UUID | NOT NULL, REFERENCES cases(id) | Case reference |
| `technician_id`| UUID | NOT NULL, REFERENCES profiles(id) | Assigned technician |
| `assigned_by` | UUID | NOT NULL, REFERENCES profiles(id) | Assigning receptionist/owner |
| `assigned_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Assignment timestamp |
| `acknowledged_at`| TIMESTAMPTZ| NULLABLE | Tech receipt confirmation |
| `completed_at` | TIMESTAMPTZ | NULLABLE | Completion timestamp |
| `unassigned_at` | TIMESTAMPTZ| NULLABLE | Reassignment timestamp |
| `unassign_reason`| TEXT | NULLABLE | Reason for reassignment |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT true | Active assignment flag |

### `audit_logs` (IMMUTABLE)
Append-only administrative security audit trail for user provisioning, role adjustments, and settings changes.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Identifier |
| `action` | audit_action | NOT NULL | Action category |
| `actor_id` | UUID | REFERENCES profiles(id) | User who executed the action |
| `target_id` | UUID | NULLABLE | Affected entity UUID |
| `target_type` | TEXT | NULLABLE | 'user', 'case', 'settings' |
| `details` | JSONB | DEFAULT '{}' | Parameter diffs, reason, context |
| `ip_address` | INET | NULLABLE | Caller IP address |
| `user_agent` | TEXT | NULLABLE | Client user agent |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Server timestamp |

---

## 4. Pricing & Accounts (migration `015_pricing.sql`)

Currency: Egyptian pound (جنيه مصري). Every amount is `numeric(12,2)` (never float). No VAT / e-invoicing.
**Money is visible only to active owners and receptionists.** Technicians and representatives can read `cases`, `dentists` and `work_types`, so no money column was added to those tables; all money lives in the five tables below (RLS on each; anon has no privileges; technicians, representatives and inactive users see no rows). Tests: `src/test/db/pricing.test.ts`.

### `price_list`
One price per work type. Owner inserts/updates; owner + receptionist read; no delete.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `work_type_id` | UUID | PRIMARY KEY, REFERENCES work_types(id) | Work type |
| `price` | NUMERIC(12,2) | NOT NULL, >= 0 | List price (EGP) |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Set by trigger |
| `updated_by` | UUID | REFERENCES profiles(id) | Set by trigger (`auth.uid()`) |

### `dentist_discounts`
One discount per doctor. Owner inserts/updates; owner + receptionist read; no delete (set 0 instead).
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `dentist_id` | UUID | PRIMARY KEY, REFERENCES dentists(id) | Doctor |
| `discount_percent` | NUMERIC(5,2) | NOT NULL, 0–100 | Discount % |
| `updated_at`, `updated_by` | | | Set by trigger |

### `dentist_opening_balances` (optional, رصيد افتتاحي)
What a doctor owed (or was owed) before the money module. Old deliveries are never charged case by case; the owner decides per doctor whether to enter an opening balance. Owner inserts/updates/deletes (deleting = "no opening balance"); owner + receptionist read; service role and anon cannot write. Every change is audited (`settings_changed` / `opening_balance`, `op` = `opening_set` / `opening_changed` / `opening_removed`, with old and new amount and `as_of`).
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `dentist_id` | UUID | PRIMARY KEY, REFERENCES dentists(id) | Doctor |
| `amount` | NUMERIC(12,2) | NOT NULL, not 0 (016: delete the row instead) | > 0 the doctor owes the lab; < 0 credit (the lab owes the doctor) |
| `as_of` | DATE | NOT NULL, not after today in Cairo (016) | Cairo date the balance counts on (normally the go-live date) |
| `note` | TEXT | up to 2000 chars | |
| `updated_at`, `updated_by` | | | Set by trigger |

In a statement it is a line of kind `opening` on `as_of` (at Cairo midnight, before anything else that day): before `p_from` it is part of the opening balance, inside the period it is a line, after `p_to` it is ignored. `get_dentist_balances` (`balance`, plus `opening_balance` / `opening_as_of` columns) and `get_owner_dashboard_stats.total_outstanding` include it.

### `case_charges`
One row per case, inserted by trigger `trg_create_case_charge` (AFTER INSERT on `cases`). Owner + receptionist read; only the owner may update, and only `list_price` / `discount_percent` (column grant). No client insert or delete.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `case_id` | UUID | PRIMARY KEY, REFERENCES cases(id) ON DELETE CASCADE | Case |
| `list_price` | NUMERIC(12,2) | NULLABLE, >= 0 | Snapshot of the price list. **NULL = not priced** |
| `discount_percent` | NUMERIC(5,2) | NOT NULL, 0–100 | Snapshot of the doctor's discount |
| `net_amount` | NUMERIC(12,2) | GENERATED STORED | `round(list_price * (1 - discount_percent / 100), 2)` |
| `price_source` | TEXT | `list` or `manual` | `manual` after a direct edit of this case's price |
| `updated_at`, `updated_by` | | | Set by trigger |

Snapshot rules:
- `cases.case_type` is a text snapshot of the work type **name**; it is matched to `work_types` by `lower(btrim(name))` (active or inactive types). Legacy values (e.g. `Crown`) match nothing and stay unpriced.
- Price list or discount changes never change an already priced charge.
- When the owner sets a price for a work type, that type's **unpriced** `list` charges (not cancelled; delivered ones included on purpose, they become due at that price) take the price and the doctor's current discount. The price audit row lists them (`priced_cases_count`, `priced_case_ids`).
- Changing an open case's work type or doctor re-snapshots a `list` charge (`manual` charges are kept); the change is audited per case (`case_repriced`). A work type change on a delivered case does not re-price it.
- **Doctor of a delivered case:** only the owner (or a trusted SQL session) may change it; receptionists and the service role get `err.case.delivered_dentist_locked`. A `list` charge then takes the new doctor's current discount, a `manual` charge is kept, and it is always audited (`case_dentist_changed`, old/new doctor and amounts).
- A case's doctor cannot be changed once it has payments (`err.case.has_payments`).
- A **direct** update of `case_charges` (trigger depth 1: the owner from the app, or anyone in the SQL editor) sets `price_source = 'manual'` and is audited (`case_price_changed`). Updates made by the triggers above stay `list`.
- Open cases that existed before 015 got a charge (unpriced, current doctor discount); delivered/cancelled cases from before 015 got none (they never appear in balances).

**When is a charge due?** Only when the case is `delivered` and has a doctor. The date is `cases.delivered_at` (server-managed: set to `now()` by `trg_validate_case_status` on the transition to `delivered`; clients cannot write it; a case inserted directly as `delivered` is stamped by `trg_stamp_delivered_on_insert`). Only rows from before 015 can lack it; they fall back to `cases.created_at` (never `updated_at`, which moves on every edit). Cancelled cases never count. Cases without `dentist_id` are in no doctor's account (the owner dashboard counts them: `delivered_without_dentist_count`).

### `payments` (APPEND-ONLY)
Owner and receptionist insert and read. `UPDATE`, `DELETE` and `TRUNCATE` are revoked from the API roles, and triggers `trg_payments_no_update_delete` / `trg_payments_no_truncate` refuse them for **every** role, including the database owner (`err.payment.append_only`). Restores are not affected (`pg_restore` loads data with COPY into fresh tables before the triggers exist). The service role has no INSERT/UPDATE/DELETE/TRUNCATE on any of the four money tables.

A per-case payment must name a case of the same doctor that has a charge row and is not cancelled (`err.payment.case_not_billable`); payments without a case are always allowed. The case row is read `FOR SHARE`, so a concurrent doctor change and payment on the same case cannot both commit (not testable on PGlite, which has one connection). `received_by` / `received_at` are set by the database for every API request; only trusted SQL sessions may set them.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | Identifier |
| `dentist_id` | UUID | NOT NULL, REFERENCES dentists(id) | Doctor who paid |
| `case_id` | UUID | NULLABLE, REFERENCES cases(id) | Per-case payment; NULL = on account (e.g. monthly). Must belong to the same doctor |
| `amount` | NUMERIC(12,2) | not 0; > 0 for a payment, < 0 for a reversal | EGP |
| `method` | TEXT | `cash`, `transfer` or `other` | |
| `received_at` | TIMESTAMPTZ | NOT NULL | `now()`, forced by trigger for API requests (no back-dating) |
| `received_by` | UUID | REFERENCES profiles(id) | `auth.uid()`, forced by trigger |
| `note` | TEXT | up to 2000 chars | |
| `reverses_payment_id` | UUID | REFERENCES payments(id), unique when set | Correction of an earlier payment |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

Reversal rules (trigger `trg_payments_validate`): the original must exist and must not itself be a reversal; at most one reversal per payment (checked under a row lock on the original, backed by a partial unique index); `amount = -original.amount`; doctor, case and method are copied from the original. A reversal is allowed even if the case was cancelled since.

### Audit (existing `audit_action` values, no enum change)
| Change | `action` | `target_type` |
| :--- | :--- | :--- |
| Price set or changed | `settings_changed` | `price` (target_id = work type; `details.priced_case_ids`) |
| Discount set or changed | `settings_changed` | `dentist_discount` |
| Direct edit of a case price | `settings_changed` | `case_price` (`op` = `case_price_changed`) |
| Open case re-priced after a work type / doctor change | `settings_changed` | `case_price` (`op` = `case_repriced`) |
| Doctor of a delivered case changed (owner) | `settings_changed` | `case_price` (`op` = `case_dentist_changed`) |
| Payment or reversal | `system_event` | `payment` (`details.op` = `payment_recorded` / `payment_reversed`) |

### Functions (SECURITY DEFINER, `search_path = ''`, EXECUTE revoked from PUBLIC/anon)
| Function | Who | Returns |
| :--- | :--- | :--- |
| `get_dentist_statement(p_dentist_id, p_from, p_to)` | owner, receptionist | jsonb: `dentist`, `opening_balance` (before `p_from`), `lines` (delivered cases and payments/reversals in the period, Cairo dates inclusive, ordered by time, with running `balance`; unpriced delivered cases are listed with `priced = false` and not counted; from 017 every line has `is_reversed`, true for a payment that already has a reversal), `total_debit`, `total_credit`, `closing_balance`, `unpriced_count` |
| `get_dentist_balances()` | owner, receptionist | One row per doctor: `total_due` (delivered, priced), `total_paid` (incl. reversals), `balance`, `unpriced_delivered_count`, `last_payment_at` (latest payment that is not a reversal and was not reversed) |
| `get_case_balance(p_case_id)` | owner, receptionist | `list_price`, `discount_percent`, `net_amount`, `price_source`, `is_priced`, `is_due` (delivered **and** has a doctor), `paid` (payments on this case, always returned), `remaining` (`net - paid` only when due and priced, otherwise NULL) |
| `get_owner_dashboard_stats()` | owner | jsonb: count per status, `total`, `overdue` (Cairo date), `active_employees`, `total_outstanding`, `unpriced_delivered_count`, `delivered_without_dentist_count` (KNOWN_ISSUES #16) |

Balance sign: positive = the doctor owes the lab; negative = credit.
