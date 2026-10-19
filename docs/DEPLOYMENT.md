# Deployment, Provisioning & Free-Tier Operational Guide

## 1. Prerequisites
- **Node.js**: v18.0.0 or later (v24.18.0 verified in development)
- **Package Manager**: npm 9+
- **Supabase Account**: Free tier (https://supabase.com)
- **PostgreSQL Client (Optional)**: `psql` or `pg_dump` for offline backups

---

## 2. Environment Configuration

1. Create a `.env` file in the project root based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

2. Populate the required variables from your Supabase Project Settings (`Settings > API`):
   ```ini
   # Required for frontend client
   VITE_SUPABASE_URL=https://[YOUR_PROJECT_REF].supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

> [!CAUTION]
> **NEVER** place the `SUPABASE_SERVICE_ROLE_KEY` into `.env` or client bundles. The service role key is reserved strictly for server-side Edge Functions or CI/CD deployment secrets.

---

## 3. Database Migration & Setup

1. Log into your Supabase Dashboard.
2. Navigate to the **SQL Editor**.
3. Execute the schema migration in order:
   - Run `supabase/migrations/001_initial_schema.sql` (Creates custom types, tables, constraints, sequences, triggers, and RLS policies).
   - Run `supabase/migrations/002_owner_protections.sql` (Adds last-owner guards and technician reassignment logic).
   - Run `supabase/migrations/003_security_hardening.sql` (Security fixes; required).
   - Run `supabase/migrations/004_permission_fixes.sql` (Role permission fixes; required).
   - Run `supabase/migrations/005_work_types.sql` (Owner-managed work types; required). Then sign in as the owner and add the lab's work types at /work-types before registering cases.
4. (Optional for testing): Run `scripts/seed_demo_data.sql` to populate sample dentists and initial cases.

---

## 4. Initial Owner Provisioning Procedure

To prevent public backdoors or hardcoded passwords, the first laboratory Owner is provisioned through one of two secure methods:

### Method A: Supabase Dashboard (Recommended)
1. In the Supabase Dashboard, go to **Authentication > Users** $\rightarrow$ Click **"Add user"**.
2. Select **"Create user"**, input the owner's email (e.g., `owner@dentallab.com`) and a strong temporary password.
3. Check **"Auto Confirm User"**.
4. In the **SQL Editor**, assign the initial Owner role:
   ```sql
   UPDATE profiles
   SET role = 'owner', status = 'active'
   WHERE email = 'owner@dentallab.com';
   ```
5. The Owner can now sign in at `/login`. Once logged in, the Owner can manage the entire staff from the `/employees` screen.

### Method B: Self-Service Initial Bootstrap Guard (Single Deployment)
If programmatic bootstrap is required, create a temporary SQL script:
```sql
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Insert only if no owner currently exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE role = 'owner') THEN
    -- Auth user creation or direct profile link
    RAISE NOTICE 'Provisioning initial Owner...';
  END IF;
END $$;
```

---

## 5. Free-Tier Service Limits & Operational Mitigations

| Service / Resource | Free Tier Quota | Limit Exceeded Behavior | Operational Mitigation |
| :--- | :--- | :--- | :--- |
| **Supabase Database Storage** | 500 MB PostgreSQL | Database switches to read-only mode if quota exceeded. | Run `scripts/backup.ps1` weekly; archive old completed cases or prune audit logs older than 2 years. 500MB holds ~250,000 case records. |
| **Project Activity** | Pauses after 7 days of zero API calls | App returns 503 until unpaused in dashboard (takes ~1-2 minutes). | For active labs with daily use, the project never pauses. If paused during holiday, click "Restore project" in the Supabase Dashboard. |
| **Auth Emails** | 30 emails / hour (Supabase default) | Rate limit reached; invitations queued or delayed. | For higher volume, connect your own free SMTP provider (e.g. Resend free tier: 3,000 emails/month). |
| **Edge Functions** | 500,000 invocations / month | Function calls blocked until cycle resets. | Administrative actions (user invites) occur infrequently, well below 5,000/mo. |
| **Static Hosting (Vercel/Netlify)** | 100 GB bandwidth / mo | Bandwidth throttled or billed. | Built SPA assets are lightweight (558 KB total bundle, 161 KB gzipped). |

---

## 6. Regular Backup & Disaster Recovery

Because Supabase free tier does not include automated daily point-in-time recovery (PITR), off-site manual backups should be scheduled regularly.

### To take a backup:
On Windows PowerShell:
```powershell
.\scripts\backup.ps1 -DatabaseUrl "postgresql://postgres:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

On Linux / macOS:
```bash
./scripts/backup.sh "postgresql://postgres:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```
Backups are saved to `./backups/dental_cms_backup_[TIMESTAMP].sql`.

### To restore from a backup:
```powershell
.\scripts\restore.ps1 -BackupFile "./backups/dental_cms_backup_20261014_120000.sql" -DatabaseUrl "postgresql://postgres:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

---

## 7. Account Recovery Procedures

If the Owner forgets their password:
1. Owner clicks "Forgot password" or requests password reset via Supabase Auth email.
2. If email delivery is unavailable, another active Owner (if configured) can navigate to `/employees` $\rightarrow$ Click the **Key** icon next to the user $\rightarrow$ "Send Password Reset".
3. If all Owners are locked out, the database administrator can execute a secure password update via the Supabase Dashboard SQL Editor without disclosing credentials:
   ```sql
   UPDATE auth.users
   SET encrypted_password = crypt('NewSecurePassword2026!', gen_salt('bf'))
   WHERE email = 'owner@dentallab.com';
   ```
