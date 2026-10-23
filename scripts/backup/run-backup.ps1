# =============================================================================
# Dolphin lab: encrypted backup to Google Drive.
#
#   Scheduled (at Windows logon + midday):  run-backup.ps1
#       skips when a successful backup is younger than minHoursBetween (20 h),
#       retries every RetrySeconds while there is no internet.
#   Desktop shortcut "back up now":          run-backup.ps1 -Now
#
# Steps: count rows -> pg_dump (public, private, auth.users/identities) ->
# count again (must match, else retry) -> zip with manifest -> encrypt with the
# age PUBLIC key -> upload with rclone -> verify MD5 on Drive -> retention.
# Plain dumps exist only in the work folder and are deleted in every case.
# Exit code 0 = success or skipped, 1 = failed.
# =============================================================================
param(
  [switch]$Now,
  [int]$MaxAttempts = 13,
  [int]$RetrySeconds = 600
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Invoke-BackupOnce($Config, $Db) {
  if (Test-Path $script:Paths.Work) { Remove-Item $script:Paths.Work -Recurse -Force }
  New-Item -ItemType Directory -Path $script:Paths.Work -Force | Out-Null
  try {
    $pgEnv = Get-PgEnv $Db
    $before = Get-RowCounts $Db

    $common = @('--format=custom', '--no-owner', '--no-privileges', '-d', $Db.ConnInfo)
    $dumps = @(
      @{ File = 'public.dump'; Args = @('--schema=public', '--schema=private') },
      @{ File = 'auth.dump'; Args = @('--table=auth.users', '--table=auth.identities') }
    )
    foreach ($d in $dumps) {
      $r = Invoke-Native $script:Tools.PgDump ($d.Args + $common + @('--file', (Join-Path $script:Paths.Work $d.File))) $pgEnv
      if ($r.ExitCode -ne 0) { throw ('pg_dump failed: ' + $r.StdErr) }
    }

    $after = Get-RowCounts $Db
    if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
      throw $script:Msg.DataChanged
    }

    $ver = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-At', '-d', $Db.ConnInfo, '-c', 'SHOW server_version') $pgEnv
    $stamp = Get-Date
    Write-JsonFile (Join-Path $script:Paths.Work 'manifest.json') ([ordered]@{
      format        = 1
      createdAt     = $stamp.ToString('o')
      serverVersion = $ver.StdOut.Trim()
      counts        = $after
    })

    $name = 'dolphin-backup-{0}.zip.age' -f $stamp.ToString('yyyyMMdd-HHmmss')
    $zip = Join-Path $script:Paths.Work 'backup.zip'
    Compress-Archive -Path (Join-Path $script:Paths.Work '*.dump'), (Join-Path $script:Paths.Work 'manifest.json') -DestinationPath $zip
    $encrypted = Join-Path $script:Paths.Local $name
    $r = Invoke-Native $script:Tools.Age @('--encrypt', '--recipient', $Config.recipient, '--output', $encrypted, $zip)
    if ($r.ExitCode -ne 0) { throw ('age failed: ' + $r.StdErr) }
  } finally {
    # Never leave unencrypted data behind.
    if (Test-Path $script:Paths.Work) { Remove-Item $script:Paths.Work -Recurse -Force }
  }

  # Upload and verify.
  $rc = @('--config', $script:Paths.Rclone)
  $dest = $Config.remote.TrimEnd('/', '\')
  $r = Invoke-Native $script:Tools.Rclone (@('copyto', $encrypted, "$dest/$name", '--retries', '5') + $rc)
  if ($r.ExitCode -ne 0) { throw ('rclone upload failed: ' + $r.StdErr) }
  $r = Invoke-Native $script:Tools.Rclone (@('md5sum', $dest, '--include', $name) + $rc)
  $localMd5 = (Get-FileHash $encrypted -Algorithm MD5).Hash.ToLower()
  if ($r.ExitCode -ne 0 -or $r.StdOut -notmatch "^$localMd5\s+") { throw ('upload verification failed: ' + $r.StdErr) }

  # Retention on Drive.
  $r = Invoke-Native $script:Tools.Rclone (@('lsf', $dest, '--files-only') + $rc)
  if ($r.ExitCode -eq 0) {
    $names = @($r.StdOut -split "`r?`n" | Where-Object { $_ })
    foreach ($old in (Get-BackupsToDelete $names (Get-Date) $Config.keepDaily $Config.keepMonthly)) {
      $d = Invoke-Native $script:Tools.Rclone (@('deletefile', "$dest/$old") + $rc)
      Write-BackupLog ("حذف نسخة قديمة من Drive: {0} (exit {1})" -f $old, $d.ExitCode)
    }
  }
  # Retention on this PC.
  Get-ChildItem $script:Paths.Local -File | Where-Object { $_.Name -match $script:BackupNamePattern } |
    Sort-Object Name -Descending | Select-Object -Skip $Config.keepLocal | Remove-Item -Force

  return $name
}

# ---- main --------------------------------------------------------------------
Initialize-BackupHome
$mutex = Get-BackupLock   # the same lock as install-tools.ps1
if (-not $mutex) {
  Write-BackupLog 'تخطي: يوجد نسخ احتياطي أو تركيب للبرامج يعمل بالفعل.'
  if ($Now) { Show-OwnerMessage $script:Msg.AlreadyRunning }
  exit 0
}
try {
  $config = Get-BackupConfig
  $url = Get-DbUrl
  if (-not $config -or -not $config.recipient -or -not $config.remote -or -not $url) {
    Write-BackupLog $script:Msg.NotSetUp
    Show-OwnerMessage $script:Msg.NotSetUp -IsError
    exit 1
  }
  if (-not (Test-ToolsInstalled @('Rclone', 'Age', 'PgDump', 'Psql'))) {
    Write-BackupLog $script:Msg.ToolsMissing
    Show-OwnerMessage $script:Msg.ToolsMissing -IsError
    exit 1
  }
  $db = ConvertFrom-DbUrl $url
  $state = Read-JsonFile $script:Paths.State
  $last = if ($state -and $state.lastSuccess) { [datetime]::Parse($state.lastSuccess) } else { $null }

  if (-not $Now -and $last -and ((Get-Date) - $last).TotalHours -lt $config.minHoursBetween) {
    Write-BackupLog ('تخطي: آخر نسخة ناجحة {0}' -f $last.ToString('yyyy-MM-dd HH:mm'))
    exit 0
  }

  $attempts = if ($Now) { 1 } else { [Math]::Max(1, $MaxAttempts) }
  for ($i = 1; $i -le $attempts; $i++) {
    try {
      if (-not (Test-NetworkReachable $db.Host $db.Port)) { throw $script:Msg.NoInternet }
      Write-BackupLog ("بدء النسخ الاحتياطي (محاولة {0} من {1})" -f $i, $attempts)
      $name = Invoke-BackupOnce $config $db
      Write-JsonFile $script:Paths.State ([ordered]@{ lastSuccess = (Get-Date).ToString('o'); lastFile = $name })
      Write-BackupLog ("نجاح: {0}" -f $name)
      if ($Now) { Show-OwnerMessage ("{0}`n`n{1}" -f $script:Msg.Success, $name) }
      exit 0
    } catch {
      Write-BackupLog ("فشل المحاولة {0}: {1}" -f $i, $_.Exception.Message)
      if ($i -lt $attempts) { Start-Sleep -Seconds $RetrySeconds }
    }
  }

  $text = $script:Msg.Failed
  if (-not $last -or ((Get-Date) - $last).TotalDays -gt 3) { $text = $text + "`n`n" + $script:Msg.OldBackupWarning }
  $text = $text + "`n`n" + $script:Paths.Logs
  Show-OwnerMessage $text -IsError
  exit 1
} finally {
  Exit-BackupLock $mutex
}
