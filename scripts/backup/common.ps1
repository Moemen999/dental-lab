# =============================================================================
# Dolphin lab backup: shared settings and helpers (dot-sourced by the other scripts).
#
# Everything private lives OUTSIDE the repo, in %LOCALAPPDATA%\DolphinBackup:
#   config.json   non-secret settings (Drive folder, age public key, retention)
#   db.secret     database connection string, encrypted with Windows DPAPI
#                 (only this Windows user on this PC can decrypt it)
#   rclone.conf   Google Drive login token written by rclone
#   state.json    time of the last successful backup
#   local\        last encrypted backups kept on the PC
#   logs\         monthly log files (passwords are masked)
#   tools\        rclone, age, PostgreSQL client binaries; each tool folder has
#                 a .installed marker (verified SHA-256 + version) written last
#   downloads\    the verified tool zips (kept, so a reinstall needs no download)
# The age PRIVATE key is never stored here: the owner keeps it off the PC.
#
# Test overrides: DOLPHIN_BACKUP_HOME, DOLPHIN_BACKUP_TOOLS, DOLPHIN_BACKUP_DOWNLOADS,
# DOLPHIN_BACKUP_QUIET=1.
# This file must stay UTF-8 with BOM (Windows PowerShell 5.1 reads Arabic text correctly only then).
# =============================================================================

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:BackupHome = if ($env:DOLPHIN_BACKUP_HOME) { $env:DOLPHIN_BACKUP_HOME } else { Join-Path $env:LOCALAPPDATA 'DolphinBackup' }
$script:ToolsDir = if ($env:DOLPHIN_BACKUP_TOOLS) { $env:DOLPHIN_BACKUP_TOOLS } else { Join-Path $script:BackupHome 'tools' }
$script:DownloadsDir = if ($env:DOLPHIN_BACKUP_DOWNLOADS) { $env:DOLPHIN_BACKUP_DOWNLOADS } else { Join-Path $script:BackupHome 'downloads' }

$script:Paths = @{
  Config  = Join-Path $script:BackupHome 'config.json'
  Secret  = Join-Path $script:BackupHome 'db.secret'
  Rclone  = Join-Path $script:BackupHome 'rclone.conf'
  State   = Join-Path $script:BackupHome 'state.json'
  Local   = Join-Path $script:BackupHome 'local'
  Logs    = Join-Path $script:BackupHome 'logs'
  Work    = Join-Path $script:BackupHome 'work'
  App     = Join-Path $script:BackupHome 'app'
}

$script:Tools = @{
  Rclone    = Join-Path $script:ToolsDir 'rclone\rclone.exe'
  Age       = Join-Path $script:ToolsDir 'age\age.exe'
  AgeKeygen = Join-Path $script:ToolsDir 'age\age-keygen.exe'
  PgDump    = Join-Path $script:ToolsDir 'pgsql\bin\pg_dump.exe'
  PgRestore = Join-Path $script:ToolsDir 'pgsql\bin\pg_restore.exe'
  Psql      = Join-Path $script:ToolsDir 'pgsql\bin\psql.exe'
  InitDb    = Join-Path $script:ToolsDir 'pgsql\bin\initdb.exe'
  PgCtl     = Join-Path $script:ToolsDir 'pgsql\bin\pg_ctl.exe'
}

# The download package (= folder under tools\) each program comes from.
$script:ToolPackageOf = @{
  Rclone = 'rclone'; Age = 'age'; AgeKeygen = 'age'
  PgDump = 'pgsql'; PgRestore = 'pgsql'; Psql = 'pgsql'; InitDb = 'pgsql'; PgCtl = 'pgsql'
}

# Pinned downloads. How each hash was obtained is explained in install-tools.ps1.
# Files   : zip entry -> path inside tools\<Name>
# Folders : every file under <ZipRoot><folder>/ goes to tools\<Name>\<folder>\
$script:ToolPackages = [ordered]@{
  rclone = @{
    Name = 'rclone'; Version = '1.75.2'
    Url = 'https://github.com/rclone/rclone/releases/download/v1.75.2/rclone-v1.75.2-windows-amd64.zip'
    Sha256 = '8a9db2bad1dc79a65b3348fd857069598e2aab7cf4d118b77b1df23055aff818'
    SumsUrl = 'https://downloads.rclone.org/v1.75.2/SHA256SUMS'
    Files = @{ 'rclone-v1.75.2-windows-amd64/rclone.exe' = 'rclone.exe' }
  }
  age = @{
    Name = 'age'; Version = '1.3.2'
    Url = 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-windows-amd64.zip'
    Sha256 = 'f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7'
    Files = @{ 'age/age.exe' = 'age.exe'; 'age/age-keygen.exe' = 'age-keygen.exe'; 'age/LICENSE' = 'LICENSE' }
  }
  pgsql = @{
    Name = 'pgsql'; Version = '17.11-5'
    Url = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
    Sha256 = '80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f'
    ZipRoot = 'pgsql/'; Folders = @('bin', 'lib', 'share')
  }
}

$script:BackupNamePattern = '^dolphin-backup-(\d{8})-(\d{6})\.zip\.age$'

# Owner-facing messages (Arabic).
$script:Msg = @{
  Title            = 'النسخ الاحتياطي - معمل دولفين'
  Success          = 'تم عمل نسخة احتياطية مشفرة ورفعها على Google Drive بنجاح.'
  Skipped          = 'توجد نسخة احتياطية حديثة، لا داعي لنسخة جديدة الآن.'
  NoInternet       = 'لا يوجد اتصال بالإنترنت أو بقاعدة البيانات. سيتم المحاولة مرة أخرى.'
  Failed           = 'فشل عمل النسخة الاحتياطية. افتح ملف السجل أو اطلب المساعدة.'
  OldBackupWarning = 'تنبيه: آخر نسخة احتياطية ناجحة كانت منذ أكثر من 3 أيام.'
  NotSetUp         = 'النسخ الاحتياطي لم يتم إعداده بعد. شغّل ملف الإعداد setup-backup.ps1 أولاً.'
  AlreadyRunning   = 'يوجد نسخ احتياطي يعمل الآن بالفعل. انتظر حتى ينتهي.'
  DataChanged      = 'تغيّرت البيانات أثناء النسخ. سيتم المحاولة مرة أخرى.'
  RestoreOk        = 'اختبار الاسترجاع نجح: كل الجداول رجعت بنفس عدد الصفوف.'
  RestoreFailed    = 'اختبار الاسترجاع فشل: عدد الصفوف لا يطابق النسخة الأصلية.'
  ToolsMissing     = 'البرامج المطلوبة غير موجودة أو تركيبها لم يكتمل. اعمل دبل كليك على setup-backup.cmd مرة واحدة.'
  ToolsBusy        = 'يوجد تركيب للبرامج أو نسخ احتياطي يعمل الآن. انتظر حتى ينتهي ثم حاول مرة أخرى.'
}

# One lock for run-backup.ps1 and install-tools.ps1: never two installs at once,
# and tools are never replaced while a backup uses them.
$script:LockName = 'Local\DolphinLabBackup'

# Takes the lock without waiting; returns the held mutex, or $null when another
# backup or install holds it. A lock left by a killed process (abandoned) is taken over.
function Get-BackupLock {
  $m = New-Object System.Threading.Mutex($false, $script:LockName)
  $got = $false
  try { $got = $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true }
  if ($got) { return $m }
  $m.Dispose()
  return $null
}

function Exit-BackupLock($Lock) {
  if ($Lock) { try { $Lock.ReleaseMutex() } finally { $Lock.Dispose() } }
}

function Initialize-BackupHome {
  foreach ($d in @($script:BackupHome, $script:Paths.Local, $script:Paths.Logs)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
}

# Masks passwords and private keys before anything is written to a log or shown.
function Protect-LogText([string]$Text) {
  if (-not $Text) { return $Text }
  $t = $Text -replace '(postgres(?:ql)?://)[^\s"''@]+@', '$1***@'
  $t = $t -replace '(?i)(password\s*=\s*)\S+', '$1***'
  $t = $t -replace '(?i)(PGPASSWORD\s*=\s*)\S+', '$1***'
  $t = $t -replace 'AGE-SECRET-KEY-[0-9A-Z]+', 'AGE-SECRET-KEY-***'
  $t = $t -replace '("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+', '$1***'
  return $t
}

function Write-BackupLog([string]$Message) {
  Initialize-BackupHome
  $file = Join-Path $script:Paths.Logs ("backup-{0}.log" -f (Get-Date -Format 'yyyy-MM'))
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Protect-LogText $Message)
  [System.IO.File]::AppendAllText($file, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($true))
}

function Show-OwnerMessage([string]$Text, [switch]$IsError) {
  if ($env:DOLPHIN_BACKUP_QUIET -eq '1') { return }
  Add-Type -AssemblyName System.Windows.Forms
  $icon = if ($IsError) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
  $opts = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign
  [void][System.Windows.Forms.MessageBox]::Show($Text, $script:Msg.Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $opts)
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  return [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
}

function Write-JsonFile([string]$Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-BackupConfig {
  $c = Read-JsonFile $script:Paths.Config
  if (-not $c) { return $null }
  # Defaults for settings the owner never has to touch.
  $defaults = @{ keepDaily = 30; keepMonthly = 12; keepLocal = 7; minHoursBetween = 20 }
  foreach ($k in $defaults.Keys) {
    if ($null -eq $c.$k) { $c | Add-Member -NotePropertyName $k -NotePropertyValue $defaults[$k] }
  }
  return $c
}

# ---- Tools: installed check and installation (used by install-tools.ps1) ----

# True when tools\<Name> was fully installed from the zip with hash $Sha256
# (default: the pinned hash): its .installed marker matches and all its programs exist.
function Test-ToolPackageInstalled([string]$Name, [string]$Sha256) {
  if (-not $Name -or -not $script:ToolPackages.Contains($Name)) { return $false }
  $p = $script:ToolPackages[$Name]
  if (-not $Sha256) { $Sha256 = $p.Sha256 }
  try { $m = Read-JsonFile (Join-Path (Join-Path $script:ToolsDir $Name) '.installed') } catch { return $false }
  if (-not $m -or [string]$m.name -ne $Name -or [string]$m.version -ne $p.Version -or [string]$m.sha256 -ne $Sha256) { return $false }
  foreach ($t in $script:ToolPackageOf.Keys) {
    if ($script:ToolPackageOf[$t] -eq $Name -and -not (Test-Path -LiteralPath $script:Tools[$t] -PathType Leaf)) { return $false }
  }
  return $true
}

# True when every program in $Names (keys of $script:Tools) exists AND its package
# has a valid .installed marker. A half-extracted folder has no marker.
function Test-ToolsInstalled([string[]]$Names) {
  foreach ($n in $Names) {
    if (-not $script:Tools.ContainsKey($n) -or -not (Test-Path -LiteralPath $script:Tools[$n] -PathType Leaf)) { return $false }
    if (-not (Test-ToolPackageInstalled $script:ToolPackageOf[$n])) { return $false }
  }
  return $true
}

function Get-StreamSha256([IO.Stream]$Stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $h = $sha.ComputeHash($Stream) } finally { $sha.Dispose() }
  $Stream.Position = 0
  return (-join ($h | ForEach-Object { $_.ToString('x2') }))
}

function Get-WebText([string]$Url) {
  $r = Invoke-WebRequest -Uri $Url -UseBasicParsing
  if ($r.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($r.Content) }
  return [string]$r.Content
}

# The hash for exactly $FileName (case-sensitive) in the text of rclone's SHA256SUMS
# file ("<64 hex>  <name>" lines, optional * before the name). Other names such as
# "<name>.sig" or another platform never match. Error when there is no such
# line, or lines with different hashes.
function Get-RcloneOfficialSha256([string]$SumsText, [string]$FileName) {
  $pattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($FileName) + '\s*$'
  $hashes = @()
  foreach ($line in ($SumsText -split "`r?`n")) {
    if ($line -cmatch $pattern) { $hashes += $Matches[1].ToLowerInvariant() }
  }
  $hashes = @($hashes | Select-Object -Unique)
  if ($hashes.Count -ne 1) { throw "SHA256SUMS: expected one hash for $FileName, found $($hashes.Count)" }
  return $hashes[0]
}

# Writes one zip entry to $Root\$Relative. Refuses, before writing anything, a path
# that is absolute, contains ':' or ends up outside $Root (e.g. '..\x',
# 'bin/../../rclone/x', or a sibling folder such as '..\tools2\x').
function Export-ZipEntry([IO.Compression.ZipArchiveEntry]$Entry, [string]$Root, [string]$Relative) {
  if (-not $Relative -or $Relative.Contains(':') -or [IO.Path]::IsPathRooted($Relative)) { throw "unsafe path in zip: $Relative" }
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $target = [IO.Path]::GetFullPath([IO.Path]::Combine($rootFull, $Relative))
  if ($target.Length -le $rootFull.Length -or -not $target.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "unsafe path in zip: $Relative"
  }
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
  # Flushed to the disk itself (not only the Windows cache) before the folder gets
  # its marker and is moved into place, so after a power cut a marked folder has
  # no unwritten files.
  $in = $Entry.Open()
  try {
    $out = New-Object IO.FileStream($target, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $in.CopyTo($out); $out.Flush($true) } finally { $out.Dispose() }
  } finally { $in.Dispose() }
}

# Writes a new file (it must not exist yet) and flushes it to the disk.
function Write-FlushedText([string]$Path, [string]$Text) {
  $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text)
  $f = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $f.Write($bytes, 0, $bytes.Length); $f.Flush($true) } finally { $f.Dispose() }
}

# Renames a folder (same drive, so the rename itself is atomic). Antivirus or a
# running program can keep a file inside open for a moment, so it tries again.
$script:MoveRetries = 5
$script:MoveRetryDelayMs = 1000
function Move-DirectoryWithRetry([string]$From, [string]$To) {
  for ($i = 1; ; $i++) {
    try { [IO.Directory]::Move($From, $To); return }
    catch {
      $why = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
      if ($i -ge $script:MoveRetries) { throw "could not move $From to ${To}: $why" }
      Start-Sleep -Milliseconds $script:MoveRetryDelayMs
    }
  }
}

# Deletes every tools\.staging-* and tools\.old-* folder left by an interrupted or
# failed run (install-tools.ps1 calls it while holding the lock). Best effort: a
# folder that cannot be deleted now is deleted by a later run.
function Clear-ToolLeftovers {
  if (-not (Test-Path -LiteralPath $script:ToolsDir)) { return }
  Get-ChildItem -LiteralPath $script:ToolsDir -Force -Directory |
    Where-Object { $_.Name -like '.staging-*' -or $_.Name -like '.old-*' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

# Extracts $Package from $Zip into $Dest (a new, empty staging folder); returns the
# number of files. For a folder package the guard root is the matched folder
# itself, so an entry under bin/ can only write inside bin\, never into another
# tool's folder.
function Expand-ToolPackage([IO.Compression.ZipArchive]$Zip, $Package, [string]$Dest) {
  $n = 0
  if ($Package.Folders) {
    foreach ($e in $Zip.Entries) {
      if (-not $e.Name) { continue }   # folder entry
      foreach ($f in $Package.Folders) {
        $prefix = $Package.ZipRoot + $f + '/'
        if ($e.FullName.StartsWith($prefix, [StringComparison]::Ordinal)) {
          Export-ZipEntry $e (Join-Path $Dest $f) $e.FullName.Substring($prefix.Length)
          $n++
          break
        }
      }
    }
  } else {
    foreach ($entryName in $Package.Files.Keys) {
      $e = $Zip.GetEntry($entryName)
      if (-not $e) { throw "missing $entryName in $($Package.Name)" }
      Export-ZipEntry $e $Dest $Package.Files[$entryName]
      $n++
    }
  }
  if ($n -eq 0) { throw "nothing extracted from $($Package.Name)" }
  return $n
}

# Installs one package into tools\<Name>. Callers must hold the backup lock
# (install-tools.ps1 does), so no other install or backup runs at the same time.
#   1. leftover tools\.staging-<Name> and tools\.old-<Name> folders are deleted;
#   2. nothing else to do when tools\<Name> has a valid marker for $ExpectedSha256;
#   3. rclone: the official SHA256SUMS (fetched now) must list the same hash;
#   4. the zip comes from the downloads folder when its hash matches, else it is downloaded;
#   5. it is hashed and extracted from the SAME open file into tools\.staging-<Name>
#      (every file flushed to disk); the files found there must be exactly as many
#      as were extracted, then the .installed marker is written (flushed) there last;
#   6. the old tools\<Name> is renamed to tools\.old-<Name> (if that fails, e.g. a
#      file is open, the old install stays as it was), the staging folder is renamed
#      to tools\<Name> (if that fails, the old folder is renamed back), and only
#      then tools\.old-<Name> is deleted. Renames are retried for a few seconds.
# An interruption at any point leaves no valid marker next to an incomplete folder,
# so Test-ToolsInstalled is false and the next run starts this package again.
# A downloaded zip is deleted only when its hash is wrong, never when it matched.
# $TestHook (tests only) is called as & $TestHook <'extracted'|'ready'> <staging folder>.
function Install-ToolPackage($Package, [string]$ExpectedSha256, [scriptblock]$TestHook) {
  $name = $Package.Name
  $expected = ([string]$ExpectedSha256).ToLowerInvariant()
  if ($expected -notmatch '^[0-9a-f]{64}$') { throw "expected SHA-256 for $name is not a 64-character hash" }
  $final = Join-Path $script:ToolsDir $name
  $staging = Join-Path $script:ToolsDir ('.staging-' + $name)
  $old = Join-Path $script:ToolsDir ('.old-' + $name)
  [void][IO.Directory]::CreateDirectory($script:ToolsDir)
  foreach ($d in @($staging, $old)) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
  if (Test-ToolPackageInstalled $name $expected) { return 'already installed' }

  $leaf = Split-Path $Package.Url -Leaf
  if ($Package.SumsUrl) {
    $official = Get-RcloneOfficialSha256 (Get-WebText $Package.SumsUrl) $leaf
    if ($official -ne $expected) { throw "SHA-256 of $name in the official SHA256SUMS ($official) differs from the pinned hash" }
  }

  $file = Join-Path (Join-Path $script:DownloadsDir $name) $leaf
  $stream = $null
  $hash = $null
  $deleteZip = $false
  try {
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $stream = [IO.File]::Open($file, 'Open', 'Read', 'Read')
      $hash = Get-StreamSha256 $stream
      if ($hash -ne $expected) { $stream.Dispose(); $stream = $null }
    }
    if (-not $stream) {
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
      Write-Host "Downloading $name ..."
      Invoke-WebRequest -Uri $Package.Url -OutFile $file -UseBasicParsing
      $stream = [IO.File]::Open($file, 'Open', 'Read', 'Read')
      $hash = Get-StreamSha256 $stream
    }
    # Nothing is extracted from a file with a wrong hash, and that file is deleted.
    if ($hash -ne $expected) { $deleteZip = $true; throw "SHA-256 mismatch for ${name}: got $hash" }
    [void][IO.Directory]::CreateDirectory($staging)
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read, $true)
    try { $count = Expand-ToolPackage $zip $Package $staging } finally { $zip.Dispose() }
    if ($TestHook) { & $TestHook 'extracted' $staging }
    # Every extracted file must still be there before the folder is marked complete.
    $onDisk = @(Get-ChildItem -LiteralPath $staging -Recurse -Force -File -ErrorAction SilentlyContinue).Count
    if ($onDisk -ne $count) { throw "staging folder of $name has $onDisk files, but $count were extracted" }
    Write-FlushedText (Join-Path $staging '.installed') (([ordered]@{ name = $name; version = $Package.Version; sha256 = $hash }) | ConvertTo-Json)
    if ($TestHook) { & $TestHook 'ready' $staging }
  } catch {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    throw
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($deleteZip) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  }

  # Swap. The old folder is renamed aside, never deleted before the new one is in place.
  $hadOld = Test-Path -LiteralPath $final
  if ($hadOld) {
    try { Move-DirectoryWithRetry $final $old }
    catch {
      Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
      throw "the old $name is in use and was kept as it was: $($_.Exception.Message)"
    }
  }
  try { Move-DirectoryWithRetry $staging $final }
  catch {
    $moveError = $_.Exception.Message
    if ($hadOld) {
      try { Move-DirectoryWithRetry $old $final }
      catch { throw "$moveError; the old $name could not be put back either: $($_.Exception.Message)" }
    }
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    throw "the new $name could not be moved into place (the old one was kept): $moveError"
  }
  if ($hadOld) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }
  return "installed $count files, sha256=$hash"
}

# ---- Database connection secret (DPAPI) ------------------------------------

function Save-DbSecret([System.Security.SecureString]$Secure) {
  Initialize-BackupHome
  $enc = ConvertFrom-SecureString -SecureString $Secure   # DPAPI, CurrentUser scope
  [System.IO.File]::WriteAllText($script:Paths.Secret, $enc, [System.Text.Encoding]::ASCII)
}

function Get-DbUrl {
  if (-not (Test-Path $script:Paths.Secret)) { return $null }
  $secure = ConvertTo-SecureString ([System.IO.File]::ReadAllText($script:Paths.Secret).Trim())
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Splits postgresql://user:password@host:port/db?sslmode=... into a libpq
# keyword string WITHOUT the password, plus the password (passed via PGPASSWORD,
# never on the command line, so it does not show in the process list).
function ConvertFrom-DbUrl([string]$Url) {
  $m = [regex]::Match($Url.Trim(), '^postgres(?:ql)?://(?<cred>.+)@(?<host>[^@:/?]+)(?::(?<port>\d+))?/(?<db>[^?]+)(?:\?(?<q>.*))?$')
  if (-not $m.Success) { throw 'err.backup.bad_url' }
  $cred = $m.Groups['cred'].Value
  $i = $cred.IndexOf(':')
  $user = if ($i -ge 0) { $cred.Substring(0, $i) } else { $cred }
  $pass = if ($i -ge 0) { $cred.Substring($i + 1) } else { '' }
  $hostName = $m.Groups['host'].Value
  $port = if ($m.Groups['port'].Success) { $m.Groups['port'].Value } else { '5432' }
  $sslmode = 'prefer'
  if ($hostName -match '\.supabase\.(com|co)$') { $sslmode = 'require' }
  if ($m.Groups['q'].Success -and $m.Groups['q'].Value -match '(?:^|&)sslmode=([a-z-]+)') { $sslmode = $Matches[1] }
  $q = { param($v) "'" + ($v -replace '\\', '\\' -replace "'", "\'") + "'" }
  $conn = 'host={0} port={1} dbname={2} user={3} sslmode={4} connect_timeout=15 application_name=dolphin-backup' -f `
    (& $q $hostName), $port, (& $q ([Uri]::UnescapeDataString($m.Groups['db'].Value))), (& $q ([Uri]::UnescapeDataString($user))), $sslmode
  return [pscustomobject]@{
    ConnInfo = $conn
    Password = [Uri]::UnescapeDataString($pass)
    Host     = $hostName
    Port     = [int]$port
  }
}

# ---- Running native tools ---------------------------------------------------

function ConvertTo-ArgString([string[]]$ArgList) {
  ($ArgList | ForEach-Object {
    if ($_ -eq '') { '""' }
    elseif ($_ -notmatch '[\s"]') { $_ }
    else { '"' + (($_ -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }
  }) -join ' '
}

# Runs an exe with arguments and extra environment variables; returns exit code and output.
function Invoke-Native([string]$Exe, [string[]]$ArgList, [hashtable]$Env = @{}, [string]$StdInText = $null) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = ConvertTo-ArgString $ArgList
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = ($null -ne $StdInText)
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = [string]$Env[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if ($null -ne $StdInText) { $p.StandardInput.Write($StdInText); $p.StandardInput.Close() }
  $p.WaitForExit()
  return [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = $out.Result; StdErr = $err.Result }
}

function Get-PgEnv($Db) {
  return @{ PGPASSWORD = $Db.Password; PGCLIENTENCODING = 'UTF8'; PGCONNECT_TIMEOUT = '15' }
}

# Exact row counts of every table in public and private, plus the auth tables we back up.
$script:CountSql = @"
SELECT n.nspname || '.' || c.relname || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p')
   AND (n.nspname IN ('public', 'private') OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
 ORDER BY 1;
"@

function Get-RowCounts($Db) {
  $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', $Db.ConnInfo, '-c', $script:CountSql) (Get-PgEnv $Db)
  if ($r.ExitCode -ne 0) { throw ('psql count failed: ' + $r.StdErr) }
  $counts = [ordered]@{}
  foreach ($line in ($r.StdOut -split "`r?`n")) {
    if ($line -match '^(.+)\|(\d+)$') { $counts[$Matches[1]] = [long]$Matches[2] }
  }
  return $counts
}

function Test-NetworkReachable([string]$HostName, [int]$Port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $task = $c.ConnectAsync($HostName, $Port)
    $ok = $task.Wait(8000) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

# ---- Retention ---------------------------------------------------------------

function Get-BackupTime([string]$Name) {
  $m = [regex]::Match($Name, $script:BackupNamePattern)
  if (-not $m.Success) { return $null }
  return [datetime]::ParseExact($m.Groups[1].Value + $m.Groups[2].Value, 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture)
}

# Keeps the newest $KeepDaily backups plus the first backup of each of the last
# $KeepMonthly calendar months. Files that do not match the backup name pattern
# are never returned (never deleted).
function Get-BackupsToDelete([string[]]$Names, [datetime]$Now, [int]$KeepDaily, [int]$KeepMonthly) {
  $items = @($Names | ForEach-Object { $t = Get-BackupTime $_; if ($t) { [pscustomobject]@{ Name = $_; Time = $t } } } |
    Sort-Object Time -Descending)
  $keep = @{}
  $items | Select-Object -First $KeepDaily | ForEach-Object { $keep[$_.Name] = $true }
  $oldestMonth = (Get-Date -Year $Now.Year -Month $Now.Month -Day 1).Date.AddMonths(-($KeepMonthly - 1))
  $items | Where-Object { $_.Time -ge $oldestMonth } |
    Group-Object { $_.Time.ToString('yyyyMM') } |
    ForEach-Object { $keep[($_.Group | Sort-Object Time | Select-Object -First 1).Name] = $true }
  return @($items | Where-Object { -not $keep[$_.Name] } | ForEach-Object { $_.Name })
}
