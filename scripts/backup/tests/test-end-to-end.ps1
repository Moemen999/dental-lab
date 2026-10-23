# =============================================================================
# End-to-end backup test with FAKE data only:
#   fake Supabase-like source (temporary local PostgreSQL + real migrations + demo seed)
#   -> run-backup.ps1 -Now (Drive replaced by a local folder, throwaway age key)
#   -> checks: encrypted, no plain text, no password in logs, skip, retry
#   -> restore-backup.ps1 into a second temporary PostgreSQL, row counts compared
# The tools are installed by install-tools.ps1 into this test's own temp folder
# (after a simulated interrupted install), from the zips kept by an earlier real
# install in %LOCALAPPDATA%\DolphinBackup\downloads (or DOLPHIN_BACKUP_DOWNLOADS).
# Those zips must already match the pinned hashes and are only READ: nothing is
# downloaded, written or deleted there, and the real tools folder is not used.
# Needs the internet only for rclone's SHA256SUMS (a few KB).
# Does not touch Supabase or Google Drive.
# =============================================================================
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$scripts = Join-Path $repo 'scripts\backup'
$cache = if ($env:DOLPHIN_BACKUP_DOWNLOADS) { $env:DOLPHIN_BACKUP_DOWNLOADS } else { Join-Path $env:LOCALAPPDATA 'DolphinBackup\downloads' }

$testHome = Join-Path ([IO.Path]::GetTempPath()) ('dolphin-e2e-' + [guid]::NewGuid().ToString('N'))
$env:DOLPHIN_BACKUP_HOME = $testHome
$env:DOLPHIN_BACKUP_TOOLS = Join-Path $testHome 'tools'
$env:DOLPHIN_BACKUP_DOWNLOADS = $cache
$env:DOLPHIN_BACKUP_QUIET = '1'
. (Join-Path $scripts 'common.ps1')
$allTools = @('Rclone', 'Age', 'AgeKeygen', 'PgDump', 'PgRestore', 'Psql', 'InitDb', 'PgCtl')

$script:failures = 0
function Assert([bool]$Cond, [string]$Label) {
  if ($Cond) { Write-Host "  ok   $Label" } else { Write-Host "  FAIL $Label" -ForegroundColor Red; $script:failures++ }
}
function Invoke-PgCtl([string[]]$ArgList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:Tools.PgCtl; $psi.Arguments = ConvertTo-ArgString $ArgList
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi); $p.WaitForExit(); return $p.ExitCode
}
function Invoke-Script([string]$Name, [string[]]$ArgList) {
  $r = Invoke-Native 'powershell.exe' (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scripts $Name)) + $ArgList)
  return $r
}
function Get-Uploaded { @(Get-ChildItem $fakeDrive -File | Where-Object { $_.Name -match $script:BackupNamePattern }) }
function Get-CacheSnapshot {
  (Get-ChildItem -LiteralPath $cache -Recurse -Force | Sort-Object FullName |
    ForEach-Object { '{0}|{1}|{2}' -f $_.FullName, $_.Length, $_.LastWriteTimeUtc.Ticks }) -join "`n"
}

# The kept zips must already match the pinned hashes, so install-tools only reads them.
foreach ($p in $script:ToolPackages.Values) {
  $zipPath = Join-Path (Join-Path $cache $p.Name) (Split-Path $p.Url -Leaf)
  $match = $false
  if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    $s = [IO.File]::Open($zipPath, 'Open', 'Read', 'Read')
    try { $match = (Get-StreamSha256 $s) -eq $p.Sha256 } finally { $s.Dispose() }
  }
  if (-not $match) { throw "Kept zip missing or different: $zipPath. Run scripts\backup\install-tools.ps1 once (it downloads the zips) or set DOLPHIN_BACKUP_DOWNLOADS." }
}
$cacheBefore = Get-CacheSnapshot

$srcPort = 54331
$srcData = Join-Path $testHome 'source-data'
$srcPassword = 'FakeSrc-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$fakeDrive = Join-Path $testHome 'fake-drive'
$keyFile = Join-Path $testHome 'test-private-key.txt'
$started = $false
try {
  New-Item -ItemType Directory -Force -Path $testHome, $fakeDrive | Out-Null

  Write-Host 'Install the tools after an interrupted install'
  $tmpTools = $script:ToolsDir
  New-Item -ItemType Directory -Force -Path (Join-Path $tmpTools 'age'), (Join-Path $tmpTools '.staging-pgsql\bin') | Out-Null
  [IO.File]::WriteAllText((Join-Path $tmpTools 'age\age.exe'), 'half written')
  [IO.File]::WriteAllText((Join-Path $tmpTools '.staging-pgsql\bin\junk.dll'), 'junk')
  Assert (-not (Test-ToolsInstalled $allTools)) 'half-written tools without markers: not installed'
  $r = Invoke-Script 'install-tools.ps1' @()
  Assert ($r.ExitCode -eq 0) "install-tools exits 0 ($($r.ExitCode)) $($r.StdErr)"
  Assert (Test-ToolsInstalled $allTools) 'all tools installed, each with a valid marker'
  Assert (@(Get-ChildItem -LiteralPath $tmpTools -Force -Directory -Filter '.staging-*').Count -eq 0) 'no staging folder left'
  Assert ((Get-Item (Join-Path $tmpTools 'age\age.exe')).Length -gt 1MB) 'the half-written age.exe was replaced'
  Assert ($r.StdOut -notmatch 'Downloading') 'nothing was downloaded'

  Write-Host 'Marker with a wrong hash'
  Write-JsonFile (Join-Path $tmpTools 'age\.installed') ([ordered]@{ name = 'age'; version = '1.3.2'; sha256 = ('0' * 64) })
  Assert (-not (Test-ToolsInstalled @('Age'))) 'treated as not installed'
  $r = Invoke-Script 'install-tools.ps1' @('-Only', 'age')
  Assert ($r.ExitCode -eq 0 -and (Test-ToolsInstalled $allTools)) "reinstalled by the next run ($($r.ExitCode)) $($r.StdErr)"
  $r = Invoke-Script 'install-tools.ps1' @()
  Assert ($r.ExitCode -eq 0 -and ([regex]::Matches($r.StdOut, 'already installed')).Count -eq 3) 'a run with everything installed changes nothing'
  Assert ((Get-CacheSnapshot) -eq $cacheBefore) 'the kept zips were only read (nothing added, changed or deleted)'
  if (-not (Test-ToolsInstalled $allTools)) { throw 'tools not installed, cannot continue' }

  Write-Host 'Fake source database'
  $pwFile = Join-Path $testHome 'pw.txt'
  [IO.File]::WriteAllText($pwFile, $srcPassword)
  $r = Invoke-Native $script:Tools.InitDb @('-D', $srcData, '-U', 'postgres', '--auth=scram-sha-256', "--pwfile=$pwFile", '--encoding=UTF8', '--no-locale')
  Remove-Item $pwFile
  if ($r.ExitCode -ne 0) { throw $r.StdErr }
  if ((Invoke-PgCtl @('-D', $srcData, '-l', (Join-Path $testHome 'source.log'), '-o', "-p $srcPort -c listen_addresses=127.0.0.1", '-w', 'start')) -ne 0) { throw 'source start failed' }
  $started = $true
  $src = ConvertFrom-DbUrl "postgresql://postgres:$srcPassword@127.0.0.1:$srcPort/postgres"
  $pgEnv = Get-PgEnv $src
  $files = @((Join-Path $scripts 'restore-stub.sql'), (Join-Path $PSScriptRoot 'fake-source-extra.sql'))
  $files += Get-ChildItem (Join-Path $repo 'supabase\migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { $_.FullName }
  foreach ($f in $files) {
    $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', $src.ConnInfo, '-f', $f) $pgEnv
    if ($r.ExitCode -ne 0) { throw "$(Split-Path $f -Leaf): $($r.StdErr)" }
  }
  # Fake staff (the signup trigger creates their profiles) and the demo seed.
  $staff = @"
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@example.test', '{"full_name":"Test Owner"}', now()),
  ('00000000-0000-4000-8000-000000000003', 'tech@example.test', '{"full_name":"Test Tech"}', now());
INSERT INTO auth.identities (user_id) SELECT id FROM auth.users;
UPDATE profiles SET role = 'technician', status = 'active' WHERE id = '00000000-0000-4000-8000-000000000003';
INSERT INTO work_types (name) VALUES ('تقويم متحرك'), ('Retainer');
"@
  $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', $src.ConnInfo, '-c', $staff) $pgEnv
  if ($r.ExitCode -ne 0) { throw "staff: $($r.StdErr)" }
  $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', $src.ConnInfo, '-f', (Join-Path $repo 'scripts\seed_demo_data.sql')) $pgEnv
  if ($r.ExitCode -ne 0) { throw "seed: $($r.StdErr)" }
  $srcCounts = Get-RowCounts $src
  Assert ($srcCounts['public.cases'] -gt 0 -and $srcCounts['auth.users'] -eq 2) "source has fake data (cases=$($srcCounts['public.cases']))"

  Write-Host 'Setup (non-interactive equivalent of setup-backup.ps1)'
  $r = Invoke-Native $script:Tools.AgeKeygen @('-o', $keyFile)
  $recipient = (Invoke-Native $script:Tools.AgeKeygen @('-y', $keyFile)).StdOut.Trim()
  Initialize-BackupHome
  Write-JsonFile $script:Paths.Config ([ordered]@{ remote = $fakeDrive; recipient = $recipient })
  Save-DbSecret (ConvertTo-SecureString "postgresql://postgres:$srcPassword@127.0.0.1:$srcPort/postgres" -AsPlainText -Force)
  [IO.File]::WriteAllText($script:Paths.Rclone, '')

  Write-Host 'Back up now'
  $r = Invoke-Script 'run-backup.ps1' @('-Now')
  Assert ($r.ExitCode -eq 0) "run-backup -Now exits 0 ($($r.ExitCode)) $($r.StdErr)"
  $up = Get-Uploaded
  Assert ($up.Count -eq 1) "one encrypted file on the fake Drive ($($up.Count))"
  Assert (@(Get-ChildItem $script:Paths.Local -File).Count -eq 1) 'one encrypted copy kept on the PC'
  Assert (-not (Test-Path $script:Paths.Work)) 'no unencrypted work folder left'
  if ($up.Count -ge 1) {
    $bytes = [IO.File]::ReadAllBytes($up[0].FullName)
    $text = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
    Assert ($text.StartsWith('age-encryption.org/v1')) 'file is age-encrypted'
    Assert ($text -notmatch 'David Miller' -and $text -notmatch 'PK\x03\x04') 'no readable patient name or zip inside'
  }
  $logText = (Get-ChildItem $script:Paths.Logs -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
  Assert ($logText -notmatch [regex]::Escape($srcPassword)) 'database password never appears in logs'

  Write-Host 'Scheduled run soon after: skipped'
  $r = Invoke-Script 'run-backup.ps1' @()
  Assert ($r.ExitCode -eq 0 -and (Get-Uploaded).Count -eq 1) 'skips when a recent backup exists'

  Write-Host 'Restore test'
  $r = Invoke-Script 'restore-backup.ps1' @('-BackupFile', $up[0].FullName, '-KeyFile', $keyFile, '-Port', '54332')
  Write-Host ($r.StdOut -split "`r?`n" | Select-Object -First 40 | Out-String)
  Assert ($r.ExitCode -eq 0) "restore: all row counts match ($($r.ExitCode))"

  Write-Host 'Restore with the wrong key fails'
  $wrongKey = Join-Path $testHome 'wrong-key.txt'
  [void](Invoke-Native $script:Tools.AgeKeygen @('-o', $wrongKey))
  $r = Invoke-Script 'restore-backup.ps1' @('-BackupFile', $up[0].FullName, '-KeyFile', $wrongKey, '-Port', '54333')
  Assert ($r.ExitCode -eq 1) 'wrong key is rejected'

  Write-Host 'No connection: retries then fails'
  Remove-Item $script:Paths.State
  Save-DbSecret (ConvertTo-SecureString "postgresql://postgres:${srcPassword}@127.0.0.1:54339/postgres" -AsPlainText -Force)
  $r = Invoke-Script 'run-backup.ps1' @('-MaxAttempts', '2', '-RetrySeconds', '1')
  Assert ($r.ExitCode -eq 1) 'exits 1 after the last attempt'
  Assert ((Get-Uploaded).Count -eq 1) 'nothing new uploaded'
  $logText = (Get-ChildItem $script:Paths.Logs -File -Filter 'backup-*.log' | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
  Assert (([regex]::Matches($logText, 'فشل المحاولة')).Count -eq 2) 'logged two failed attempts'
} finally {
  if ($started) { [void](Invoke-PgCtl @('-D', $srcData, '-m', 'fast', '-w', 'stop')) }
  Start-Sleep -Milliseconds 500
  Remove-Item $testHome -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:failures) { Write-Host "$($script:failures) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All end-to-end tests passed'
