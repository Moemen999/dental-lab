# =============================================================================
# Dolphin lab: restore test.
# Decrypts a backup with the owner's PRIVATE key, restores it into a throwaway
# PostgreSQL on 127.0.0.1 (temporary folder, random password), and compares the
# row count of every table with the counts recorded when the backup was made.
# The temporary database and decrypted files are deleted at the end.
#
#   restore-backup.ps1                       newest backup on this PC (else on Drive), asks for the key file
#   restore-backup.ps1 -BackupFile X -KeyFile K
# Exit code 0 = all counts match, 1 = mismatch or error.
# =============================================================================
param(
  [string]$BackupFile,
  [string]$KeyFile,
  [int]$Port = 54329,
  [switch]$KeepDatabase
)

. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-BackupHome

function Invoke-PgCtl([string[]]$ArgList) {
  # No output redirection: postgres inherits handles and would keep pipes open.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:Tools.PgCtl
  $psi.Arguments = ConvertTo-ArgString $ArgList
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  return $p.ExitCode
}

function Select-KeyFile {
  if ($env:DOLPHIN_BACKUP_QUIET -eq '1') { throw 'KeyFile is required' }
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'اختر ملف مفتاح الاسترجاع (المفتاح الخاص)'
  $dlg.Filter = 'Key (*.txt;*.key)|*.txt;*.key|All files|*.*'
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'لم يتم اختيار ملف المفتاح.' }
  return $dlg.FileName
}

if (-not (Test-ToolsInstalled @('Age', 'PgRestore', 'Psql', 'InitDb', 'PgCtl'))) {
  Show-OwnerMessage $script:Msg.ToolsMissing -IsError
  exit 1
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('dolphin-restore-' + [guid]::NewGuid().ToString('N'))
$dataDir = Join-Path $temp 'data'
$started = $false
$report = New-Object System.Collections.Generic.List[string]
$ok = $false
try {
  New-Item -ItemType Directory -Path $temp -Force | Out-Null

  if (-not $BackupFile) {
    $latest = Get-ChildItem $script:Paths.Local -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match $script:BackupNamePattern } | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { $BackupFile = $latest.FullName }
    else {
      $config = Get-BackupConfig
      if (-not $config) { throw $script:Msg.NotSetUp }
      $rc = @('--config', $script:Paths.Rclone)
      $dest = $config.remote.TrimEnd('/', '\')
      $r = Invoke-Native $script:Tools.Rclone (@('lsf', $dest, '--files-only') + $rc)
      $name = @($r.StdOut -split "`r?`n" | Where-Object { $_ -match $script:BackupNamePattern } | Sort-Object -Descending)[0]
      if (-not $name) { throw 'لا توجد نسخ احتياطية.' }
      $BackupFile = Join-Path $temp $name
      $r = Invoke-Native $script:Tools.Rclone (@('copyto', "$dest/$name", $BackupFile) + $rc)
      if ($r.ExitCode -ne 0) { throw ('rclone download failed: ' + $r.StdErr) }
    }
  }
  if (-not $KeyFile) { $KeyFile = Select-KeyFile }
  $report.Add("النسخة: $(Split-Path $BackupFile -Leaf)")

  # 1. Decrypt and unpack.
  $zip = Join-Path $temp 'backup.zip'
  $r = Invoke-Native $script:Tools.Age @('--decrypt', '--identity', $KeyFile, '--output', $zip, $BackupFile)
  if ($r.ExitCode -ne 0) { throw ('فك التشفير فشل (المفتاح غير صحيح؟): ' + $r.StdErr) }
  $unpacked = Join-Path $temp 'unpacked'
  Expand-Archive -Path $zip -DestinationPath $unpacked
  $manifest = Read-JsonFile (Join-Path $unpacked 'manifest.json')
  $report.Add("تاريخ النسخة: $($manifest.createdAt)  إصدار السيرفر: $($manifest.serverVersion)")

  # 2. Throwaway PostgreSQL, local only, random password.
  $password = [guid]::NewGuid().ToString('N')
  $pwFile = Join-Path $temp 'pw.txt'
  [IO.File]::WriteAllText($pwFile, $password)
  $r = Invoke-Native $script:Tools.InitDb @('-D', $dataDir, '-U', 'postgres', '--auth=scram-sha-256', "--pwfile=$pwFile", '--encoding=UTF8', '--no-locale')
  Remove-Item $pwFile -Force
  if ($r.ExitCode -ne 0) { throw ('initdb failed: ' + $r.StdErr) }
  $code = Invoke-PgCtl @('-D', $dataDir, '-l', (Join-Path $temp 'server.log'), '-o', "-p $Port -c listen_addresses=127.0.0.1", '-w', 'start')
  if ($code -ne 0) { throw "pg_ctl start failed ($code)" }
  $started = $true
  $db = [pscustomobject]@{
    ConnInfo = "host=127.0.0.1 port=$Port dbname=postgres user=postgres sslmode=disable"
    Password = $password
  }
  $pgEnv = Get-PgEnv $db

  $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', $db.ConnInfo, '-f', (Join-Path $PSScriptRoot 'restore-stub.sql')) $pgEnv
  if ($r.ExitCode -ne 0) { throw ('stub failed: ' + $r.StdErr) }

  # 3. Restore order: auth tables with their keys (public.profiles references
  # auth.users), then public/private, then the auth triggers (they call public functions).
  # Each step restores only the table-of-contents lines that its filter selects.
  $auth = Join-Path $unpacked 'auth.dump'
  $public = Join-Path $unpacked 'public.dump'
  $steps = @(
    @{ Dump = $auth; Keep = { $_ -notmatch ' TRIGGER ' } },
    @{ Dump = $public; Keep = { $_ -notmatch ' SCHEMA - public ' } },  # public already exists
    @{ Dump = $auth; Keep = { $_ -match ' TRIGGER ' } }
  )
  $restoreErrors = 0
  $n = 0
  foreach ($s in $steps) {
    $n++
    $toc = Invoke-Native $script:Tools.PgRestore @('--list', $s.Dump)
    $list = Join-Path $temp "toc-$n.txt"
    [IO.File]::WriteAllLines($list, [string[]]@($toc.StdOut -split "`r?`n" | Where-Object { $_ -and -not $_.StartsWith(';') } | Where-Object $s.Keep))
    $r = Invoke-Native $script:Tools.PgRestore @('--no-owner', '--no-privileges', '-d', $db.ConnInfo, '--use-list', $list, $s.Dump) $pgEnv
    $errs = @($r.StdErr -split "`r?`n" | Where-Object { $_ -match 'error:' })
    $restoreErrors += $errs.Count
    foreach ($e in $errs) { $report.Add('تحذير pg_restore: ' + $e) }
  }

  # 4. Compare counts.
  $restored = Get-RowCounts $db
  $mismatch = 0
  $report.Add('')
  $report.Add('الجدول | في النسخة | بعد الاسترجاع')
  foreach ($p in $manifest.counts.PSObject.Properties) {
    $got = if ($restored.Contains($p.Name)) { $restored[$p.Name] } else { 'غير موجود' }
    $mark = if ("$got" -eq "$($p.Value)") { 'OK' } else { $mismatch++; 'XX' }
    $report.Add(('{0} {1} | {2} | {3}' -f $mark, $p.Name, $p.Value, $got))
  }
  $ok = ($mismatch -eq 0 -and @($manifest.counts.PSObject.Properties).Count -gt 0)
  $report.Add('')
  $report.Add(('جداول غير مطابقة: {0}  |  رسائل خطأ من pg_restore: {1}' -f $mismatch, $restoreErrors))
} catch {
  $report.Add('خطأ: ' + $_.Exception.Message)
  $ok = $false
} finally {
  if ($started -and -not $KeepDatabase) { [void](Invoke-PgCtl @('-D', $dataDir, '-m', 'fast', '-w', 'stop')) }
  if (-not $KeepDatabase -and (Test-Path $temp)) {
    Start-Sleep -Milliseconds 500
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$verdict = if ($ok) { $script:Msg.RestoreOk } else { $script:Msg.RestoreFailed }
$report.Insert(0, $verdict)
$reportFile = Join-Path $script:Paths.Logs ('restore-test-{0}.txt' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.File]::WriteAllText($reportFile, (Protect-LogText ($report -join [Environment]::NewLine)), [Text.UTF8Encoding]::new($true))
Write-BackupLog ('اختبار استرجاع: {0}' -f $(if ($ok) { 'نجح' } else { 'فشل' }))
Write-Output ($report -join [Environment]::NewLine)
Show-OwnerMessage ("{0}`n`n{1}" -f $verdict, $reportFile) -IsError:(-not $ok)
if ($ok) { exit 0 } else { exit 1 }
