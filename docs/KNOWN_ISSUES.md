# Known Issues

Issues found during the 2026-10-16 review that are **not fixed yet**. Fixed items are
listed at the end for reference.

Severity: **High** = wrong data or a permission gap, **Medium** = broken flow or
misleading behavior, **Low** = quality/performance.

## Open

### Permissions and data integrity

| # | Severity | Issue | Where |
|---|---|---|---|
| 1 | ~~High~~ ✅ Fixed (004) | ~~Representatives can UPDATE any delivery batch, including `status`, `confirmed_at`, `receptionist_id` and counts. The permissions matrix says "Confirm Batch Receipt" is denied to representatives.~~ | `batches_update` policy (`001`) |
| 2 | ~~Medium~~ ✅ Fixed (004) | ~~The status trigger lets a **receptionist** perform technician and logistics transitions (`in_progress`, `completed`, `with_representative`, `delivered`). The permissions matrix says these are denied.~~ | `validate_case_status_transition` (`003`) |
| 3 | ~~Medium~~ ✅ Fixed (006) | ~~A receptionist/owner can set `assigned_technician_id` to a user who is not an active technician with a plain UPDATE.~~ | `guard_case_columns` (`003`) |
| 4 | ~~Medium~~ ✅ Fixed (007) | ~~`technician_assignments` accepts any `assigned_by` value from the client, and its rows are written in a separate request from the case update (not atomic).~~ | `useAssignTechnician`, `assignments_insert` policy |
| 5 | ~~Medium~~ ✅ Fixed (008) | ~~Deactivating a technician **without** a replacement fails for cases in `in_progress`.~~ | `reassign_and_deactivate_technician` |
| 6 | ~~Medium~~ ✅ Fixed (009) | ~~Registering a case does not write a `created` event or a `technician_assignments` row when a technician is chosen on the form.~~ | `CaseRegistrationPage`, insert trigger |
| 7 | ~~Low~~ ✅ Fixed (Step 0) | ~~The "Add Note" button is shown to representatives, but notes are denied for that role.~~ | `CaseDetailPage.tsx` |
| 8 | ~~Low~~ ✅ Fixed (010) | ~~`batch_cases` rows can be added by representatives to any batch; `actual_count` is recalculated client-side with a read-then-write race.~~ | `useAddCaseToBatch` |
| 9 | ~~Low~~ ✅ Fixed (012) | ~~Case numbers use the server month in UTC; cases registered in Egypt just after midnight on the 1st get the previous month's prefix.~~ | `generate_case_number` |
| 10 | Low (**known, accepted**) | Edge Function `manage-users` (invites, role/status changes, session revocation) has **no automated runtime tests**: Deno is not available locally and no Supabase test project is used. It has been reviewed by reading only and is **not verified** at runtime. The database functions it calls (`reassign_and_deactivate_technician`, `get_employee_outstanding_work`) are tested in `src/test/db/`. | `supabase/functions/manage-users` |

### Frontend

| # | Severity | Issue | Where |
|---|---|---|---|
| 11 | ~~Medium~~ ✅ Fixed (011) | ~~Case search builds a PostgREST `.or()` filter by string interpolation of user input; characters like `,` `(` `)` can change the filter.~~ | `useCases` in `useSupabase.ts` |
| 12 | ~~Medium~~ ✅ Fixed (Step 2) | ~~Raw database error messages (English) are shown to users in toasts. Migration `003` adds a stable key in the error `HINT` to map them to translated text.~~ | all pages (planned for the Arabic step) |
| 13 | Low | Unused files: `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`. | `src/` |
| 14 | ~~Low~~ ✅ Fixed (Step 2) | ~~The `Inter` font is referenced but never loaded.~~ Replaced by self-hosted Cairo. | `src/index.css` |
| 19 | Low | Free text that mixes Arabic and English in one note (e.g. "الخميس. Shade confirmed: A2.") follows standard Unicode bidi: the trailing period of the English part appears on its left. Display uses `dir="auto"`; only the writer can fully control it. | case notes, instructions |
| 20 | Low | Owner dashboard pipeline links go to `/cases?status=…`, but the cases page ignores the query parameter (no filter applied). | `OwnerDashboard.tsx`, `CasesPage.tsx` |
| 15 | Low | `vite.config.ts` / `vitest.config.ts` use `__dirname` (Vite warns it will be unsupported by the native config loader). | config files |

### Performance

| # | Severity | Issue | Where |
|---|---|---|---|
| 17 | Low | `manualChunks` puts all app code into the `vendor` chunk because any path containing `react` matches. | `vite.config.ts` |

### Testing

| # | Severity | Issue | Where |
|---|---|---|---|
| 18 | Medium | The original 29 unit tests re-implement the rules inside the test files instead of testing real code; e.g. `permissions.test.ts` blocks receptionist transitions that the real trigger allows (see #2). The real-database tests in `src/test/db/` are the source of truth. | `src/test/*.test.ts` |

### Backup

| # | Severity | Issue | Where |
|---|---|---|---|
| 21 | High (**open**) | The database backup is **built and tested on fake data only, NOT installed on the lab PC**. Not verified: (a) a real connection to the Supabase Session pooler; (b) `pg_dump` 17 against the server's real PostgreSQL major version (pg_dump must be >= the server's major version); (c) Google login and `rclone config create` with the owner's own OAuth client; (d) the setup dialogs (Windows Forms, RTL) as the owner sees them; (e) the real scheduled task `DolphinLabBackup` (logon trigger, retries, 1 PM run); (f) a real restore into a new Supabase project (`pg_restore --data-only` after the migrations); (g) running under one fixed Windows user on the lab PC (DPAPI secret, folder ACL and task are tied to that user). PostgreSQL binaries come from EDB without any published checksum or signature (pinned hash only, see `install-tools.ps1`). | `scripts/backup/`, `docs/BACKUP_GUIDE_AR.md` |
| 22 | ~~Medium~~ ✅ Fixed (Step 3) | ~~(1) An interrupted extraction left a half-installed tool that `Test-ToolsInstalled` (exe-only check) then skipped. (2) The zip-slip guard and the rclone `SHA256SUMS` parser had no offline unit tests. (3) The pgsql guard only blocked writes outside `tools`, not into another tool's folder.~~ | `scripts/backup/install-tools.ps1`, `common.ps1` |
| 23 | Low | Review nits left after #22: (1) if moving the new tool folder in AND moving the old one back both fail, the next run deletes `.old-<name>` instead of restoring it (it reinstalls from the cached zip); (2) "back up now" says "a backup is running" when an install holds the lock, and setup shows "check the internet" before the busy reason; (3) `restore-backup.ps1` does not take the lock (safe today: an install cannot move an in-use folder). | `scripts/backup/` |

## Fixed

| Issue | Fix |
|---|---|
| 8 privilege holes in migrations 001/002 (self-promotion to owner, anon patient-data leak, anon technician deactivation, anon case-number generation, column tampering, client-chosen case number/status, forged history, signup as owner) | `supabase/migrations/003_security_hardening.sql`, tests in `src/test/db/security.test.ts` |
| SECURITY DEFINER functions with NULL-able permission checks and `search_path = public` | `003`: NULL-safe checks, `search_path = ''`, EXECUTE revoked from PUBLIC/anon |
| Status change and its event were two separate requests | `transition_case_status` RPC + `trg_log_case_status_change` |
| `reassigned` events violated the `case_events_status_change` check constraint | `003` writes previous/new status on those events |
| Unlayered CSS reset disabled all Tailwind spacing utilities | `src/index.css` |
| Hardcoded shared temporary password for new employees (removed; no account uses it) | Edge Function random password + setup email |
| #12 Raw English DB errors in toasts | Step 2: `src/i18n/errors.ts` maps every `err.*` hint and Postgres/Auth/network errors to Arabic; test in `src/test/i18n` |
| #14 Inter font never loaded | Step 2: Cairo, self-hosted |
| Edge Function reassignment ran with `auth.uid() = NULL` (`assigned_by` NOT NULL failure) | RPCs called with the caller's JWT |
| #1 Representatives could edit any batch entirely | `004_permission_fixes.sql`: reps create only open batches for themselves and edit only notes / expected_count / discrepancy_notes on their own open batches. Tests: `src/test/db/rolePermissions.test.ts` |
| #2 Receptionists could make technician/representative transitions | `004`: trigger `trg_enforce_role_transition_rules`; UI hides those buttons (`transitionsForRole`) |
| #3 Any profile could be set as a case's technician by UPDATE | `006_validate_assigned_technician.sql`: trigger `trg_validate_case_technician`. Tests: `src/test/db/openIssues.test.ts` |
| #4 Client-chosen `assigned_by`, non-atomic assignment rows | `007_atomic_technician_assignment.sql`: trigger `trg_sync_technician_assignment` writes history and the `reassigned` event; clients cannot write `technician_assignments`; `useAssignTechnician` sends one update |
| #5 Deactivation without replacement failed on `in_progress` cases | `008_unassign_in_progress_on_deactivation.sql`: owner may move `in_progress` → `awaiting_assignment` only while removing the technician |
| #6 Registration wrote no history | `009_case_registration_history.sql`: `created` event + assignment row on INSERT |
| #8 Representatives could add cases to any batch; client-side count | `010_batch_cases_scope.sql`: reps add only to their own open batches, `added_by` = caller, `actual_count` incremented by trigger |
| #11 Search text pasted into the PostgREST filter | `011_search_cases.sql`: `search_cases(p_query)` (SECURITY INVOKER, literal `strpos` match); `useCases` sends the text as an RPC parameter |
| #7 "Add Note" shown to representatives | `canAddCaseNote()` in `src/types/database.ts` hides it (same roles as `record_case_event`). Tests: `src/test/transitionsForRole.test.ts`, `src/test/db/openIssues.test.ts` |
| #9 Case number month taken in UTC | `012_case_number_cairo_time.sql`: month from `private.case_number_month()` in `Africa/Cairo`; existing numbers untouched. Tests: `src/test/db/caseNumberTimezone.test.ts` |
| #22 Half-installed backup tools taken as installed; zip guard and `SHA256SUMS` parser untested; pgsql guard rooted at `tools` | `Install-ToolPackage` (`common.ps1`) extracts each package into `tools\.staging-<name>` (files flushed to disk), checks the file count, writes a flushed `.installed` marker (verified SHA-256 + version) there last, renames the old `tools\<name>` to `.old-<name>` (kept as it was if that fails, e.g. a locked file) and moves staging into place with retries (old folder put back on failure); `Test-ToolsInstalled` requires the marker; leftovers (`.staging-*`, `.old-*`) are deleted and reinstalled on the next run. `install-tools.ps1` holds the backup lock `Local\DolphinLabBackup` (shared with `run-backup.ps1`), so two installs, or an install during a backup, cannot run together. `Export-ZipEntry` (guard rooted at the matched folder; absolute, UNC, drive-relative and `:` paths refused) and `Get-RcloneOfficialSha256` (takes the SUMS text, case-sensitive name) moved to `common.ps1`. Tests: `scripts/backup/tests/test-units.ps1` (zip entry guard, guard rooted at the matched folder, SHA256SUMS parser, install markers, interrupted install resumes, a package cannot overwrite another tool, files missing from staging, locked old/new folder, leftovers cleaned, install-tools arguments, shared lock incl. abandoned lock), `test-install-verify.ps1`, `test-end-to-end.ps1` |
| #16 Owner dashboard ran 17 sequential count queries every 30 seconds | One RPC `get_owner_dashboard_stats()` (migration 015; owner only; overdue by Cairo date) used by `useDashboardStats`; tests in `src/test/db/pricing.test.ts` and `src/test/dashboardStatsHook.test.tsx` |
