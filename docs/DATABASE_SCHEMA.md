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
| `tooth_number` | TEXT | NULLABLE | Tooth notation (e.g. #14, 21-23) |
| `shade` | TEXT | NULLABLE | Shade guide code (A1, A2, etc.) |
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
