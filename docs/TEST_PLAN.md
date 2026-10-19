# Test Plan & Verification Results

## 1. Test Strategy & Architecture

Testing uses **Vitest 5.0.4** with **JSDOM** and `@testing-library/react`. Tests run in a clean virtual environment and execute instantaneously.

```bash
# Run the complete test suite
npm test

# Run tests with interactive watch mode
npm run test:watch

# Run tests with code coverage analysis
npm run test:coverage
```

---

## 2. Test Suites & Executed Cases

### Suite 1: `src/test/caseNumber.test.ts` (5 Tests)
- `generates correct format for regular sequential cases`: Verifies `CASE-202610-00001` through `CASE-202610-99999`.
- `restarts counter on a new month without collision`: Validates that monthly rollover resets count without overlapping with prior months.
- `gracefully supports numbers exceeding 99,999 without truncation or recycling`: Validates that numbers at or above 100,000 expand to 6+ digits (`CASE-202610-100000`) rather than truncating.
- `rejects invalid inputs`: Verifies invalid date strings or negative counters throw exceptions.
- `guarantees unique case numbers under concurrent generation simulation`: Simulates 200 concurrent registrations resolving simultaneously with 0 duplicates.

### Suite 2: `src/test/stateMachine.test.ts` (4 Tests)
- `defines valid transitions for all statuses`: Validates all 14 statuses exist and have valid outgoing arrays.
- `allows natural clinical progression`: Validates intake $\rightarrow$ registration $\rightarrow$ assignment $\rightarrow$ in_progress $\rightarrow$ completion $\rightarrow$ reception QC $\rightarrow$ representative pickup $\rightarrow$ clinic delivery.
- `prohibits transitions from terminal statuses`: Asserts `delivered` and `cancelled` have 0 outgoing transitions.
- `allows pause on hold and rework recovery`: Asserts hold and rework transitions.

### Suite 3: `src/test/permissions.test.ts` (7 Tests)
- `rejects any action from deactivated accounts`: Asserts status check blocks state mutations.
- `allows technician to advance assigned case`: Validates tech can progress their case.
- `prohibits technician from modifying another technicians case (IDOR)`: Asserts assignment check fails when technician IDs mismatch.
- `prohibits technician from marking a case as delivered directly`: Asserts role barrier.
- `prohibits representative from modifying unreleased production cases`: Asserts representative cannot modify in-progress cases.
- `allows representative to mark picked up and delivered in sequence`: Verifies logistics flow.
- `rejects invalid state jumps such as registered -> delivered`: Verifies bypass prevention.

### Suite 4: `src/test/handoffs.test.ts` (3 Tests)
- `supports multiple individually tracked cases within a single batch`: Verifies batch contains 3 distinct cases with unique case numbers and independent statuses.
- `detects discrepancies between expected count and received count`: Verifies physical count mismatch handling and discrepancy note logging.
- `ensures distinct operational events for technician completion and reception receipt`: Confirms Stage D completion and physical receipt are recorded as distinct events with distinct actor IDs and timestamps.

### Suite 5: `src/test/employeeAdmin.test.ts` (4 Tests)
- `prohibits deactivating the single active Owner`: Protects last active owner.
- `allows deactivating an Owner if another active Owner exists`: Validates multi-owner transition.
- `allows deactivating a non-owner employee`: Validates standard employee deactivation.
- `identifies outstanding cases for a departing technician and requires reassignment`: Validates open case reassignment logic.

### Suite 6: `src/test/utils.test.ts` (5 Tests)
- `formatDate`: Correctly formats dates and null values.
- `formatDateTime`: Formats timestamps with time components.
- `formatRelativeTime`: Correctly produces "Just now", "m ago", "h ago", "d ago".
- `getInitials`: Generates uppercase initials.
- `isOverdue`: Correctly flags overdue cases based on current date.

---

## 3. Actual Automated Test Results

```
 RUN  v5.0.4

 ✓ src/test/stateMachine.test.ts (4 tests) 6ms
 ✓ src/test/employeeAdmin.test.ts (4 tests) 4ms
 ✓ src/test/caseNumber.test.ts (5 tests) 7ms
 ✓ src/test/handoffs.test.ts (3 tests) 6ms
 ✓ src/test/permissions.test.ts (7 tests) 5ms
 ✓ src/test/utils.test.ts (5 tests) 22ms

 Test Files  6 passed (6)
      Tests  28 passed (28)
   Duration  1.69s
```

All 28 tests passed with 0 failures and 0 warnings.
