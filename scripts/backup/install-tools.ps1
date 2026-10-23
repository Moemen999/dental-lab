# =============================================================================
# Dolphin lab backup: downloads the three portable tools into
# %LOCALAPPDATA%\DolphinBackup\tools and checks each file's SHA-256 BEFORE
# anything is extracted or run. Works on a clean Windows 10/11 PC with
# PowerShell 5.1 and nothing else installed (no tar.exe, no admin rights,
# nothing system-wide, no PATH change).
#
#   rclone 1.75.2  MIT licence            https://rclone.org/licence/
#   age 1.3.2      BSD 3-Clause licence   https://github.com/FiloSottile/age
#   PostgreSQL 17.11 client/server binaries (EDB zip), PostgreSQL Licence
#
# How each download is checked:
#   rclone  : the official https://downloads.rclone.org/v1.75.2/SHA256SUMS is
#             fetched at install time; its line for the zip AND the hash pinned
#             below must both equal the downloaded file's hash. (SHA256SUMS is
#             PGP-clearsigned by rclone; the PGP signature itself is NOT checked
#             because a clean PC has no gpg. Two independent hosts, github.com
#             and downloads.rclone.org, must agree with the pinned value.)
#   age     : pinned GitHub release digest (api.github.com assets[].digest).
#             age also publishes a Sigsum proof (age-v1.3.2-windows-amd64.zip.proof,
#             see https://github.com/FiloSottile/age/blob/main/SIGSUM.md). Checking
#             it needs the sigsum-verify tool (Go), so it is NOT checked here.
#   pgsql   : pinned hash of the file downloaded from get.enterprisedb.com on
#             2026-10-21. EDB publishes NO checksum or signature for the zip, and
#             the .exe/.dll inside are NOT Authenticode-signed (checked with
#             Get-AuthenticodeSignature). postgresql.org links only to EDB for
#             Windows. MSYS2 has a signed pacman package but only PostgreSQL 18.
#             Remaining risk: the pinned hash only proves the file is the SAME
#             as on 2026-10-21 ("trust on first download"), not that EDB built it.
#
# The pinned URLs, versions and hashes are in common.ps1 ($script:ToolPackages);
# the steps are in Install-ToolPackage (common.ps1). In short: each package is
# extracted into tools\.staging-<name> (files flushed to disk), the file count is
# checked, a .installed marker with the verified SHA-256 and version is written
# there last, and only then the folder is renamed to tools\<name> (the old folder
# is renamed aside first and put back if that fails). Test-ToolsInstalled
# requires the marker, so an interrupted install is never taken as installed;
# the next run deletes the leftovers (.staging-*, .old-*) and starts again.
# A package that already has a valid marker is skipped (no download, no network).
# Zips are kept in downloads\ (DOLPHIN_BACKUP_DOWNLOADS overrides the folder); a
# kept zip whose hash matches is reused and never deleted.
# The whole run holds the lock 'Local\DolphinLabBackup' that run-backup.ps1 also
# takes: a second install (e.g. setup-backup.cmd double-clicked twice) or a
# running backup makes this run stop without touching anything.
#
#   install-tools.ps1                 all three packages
#   install-tools.ps1 -Only age       only the named packages (rclone, age, pgsql)
#
# Test-only: -TestExpectedSha256 @{ age = '<hash>' } replaces the pinned hash,
# used by tests\test-install-verify.ps1 to prove a wrong hash stops the install.
# It is refused unless DOLPHIN_BACKUP_HOME is set (test mode).
# =============================================================================
param(
  [string[]]$Only,
  [hashtable]$TestExpectedSha256 = @{}
)
$ErrorActionPreference = 'Stop'

# Checked before anything is read, downloaded or written.
if ($TestExpectedSha256.Count -gt 0 -and -not $env:DOLPHIN_BACKUP_HOME) {
  throw '-TestExpectedSha256 is for tests only: it needs DOLPHIN_BACKUP_HOME (test mode)'
}
. (Join-Path $PSScriptRoot 'common.ps1')

$lock = Get-BackupLock
if (-not $lock) { throw ('{0} ({1} is held: another install-tools or a backup is running)' -f $script:Msg.ToolsBusy, $script:LockName) }
try {
  $known = @($script:ToolPackages.Keys)
  foreach ($n in @($Only) + @($TestExpectedSha256.Keys)) {
    if ($n -and -not $script:ToolPackages.Contains($n)) { throw "unknown tool package '$n' (known: $($known -join ', '))" }
  }
  foreach ($k in $TestExpectedSha256.Keys) {
    if ([string]$TestExpectedSha256[$k] -notmatch '^[0-9a-fA-F]{64}$') { throw "-TestExpectedSha256 for '$k' is not a SHA-256 hash" }
  }

  # PowerShell 5.1 defaults: TLS 1.0/1.1 only on some PCs, and a progress bar
  # that makes Invoke-WebRequest many times slower.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'

  Clear-ToolLeftovers
  foreach ($p in $script:ToolPackages.Values) {
    if ($Only -and -not ($Only -contains $p.Name)) { continue }
    $expected = if ($TestExpectedSha256.ContainsKey($p.Name)) { [string]$TestExpectedSha256[$p.Name] } else { $p.Sha256 }
    $result = Install-ToolPackage $p $expected
    Write-Host "OK $($p.Name): $result"
  }
  Write-Host 'Tools ready in' $script:ToolsDir
} finally {
  Exit-BackupLock $lock
}
