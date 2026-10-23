# Unit tests for the backup helpers (no tools, no network, no download cache).
# Everything is written under a new temp folder that is deleted at the end. Fake values only.
$env:DOLPHIN_BACKUP_HOME = Join-Path ([IO.Path]::GetTempPath()) ('dolphin-unit-' + [guid]::NewGuid().ToString('N'))
$env:DOLPHIN_BACKUP_TOOLS = Join-Path $env:DOLPHIN_BACKUP_HOME 'tools'
$env:DOLPHIN_BACKUP_DOWNLOADS = Join-Path $env:DOLPHIN_BACKUP_HOME 'downloads'
$env:DOLPHIN_BACKUP_QUIET = '1'
. (Join-Path $PSScriptRoot '..\common.ps1')
# An unexpected error still removes the temp folder.
trap { Remove-Item $env:DOLPHIN_BACKUP_HOME -Recurse -Force -ErrorAction SilentlyContinue; break }

$script:failures = 0
function Assert([bool]$Cond, [string]$Label) {
  if ($Cond) { Write-Host "  ok   $Label" } else { Write-Host "  FAIL $Label" -ForegroundColor Red; $script:failures++ }
}
function Name([datetime]$t) { 'dolphin-backup-{0}.zip.age' -f $t.ToString('yyyyMMdd-HHmmss') }

Write-Host 'Retention'
$now = Get-Date '2026-10-21 12:00'
$daily = 0..39 | ForEach-Object { Name ((Get-Date '2026-10-21 08:00').AddDays(-$_)) }   # 2026-09-12 .. 2026-10-21
$del = Get-BackupsToDelete ($daily + 'notes.txt') $now 30 12
Assert ($del.Count -eq 9) "keeps 30 newest + first of September (deletes 9, got $($del.Count))"
Assert (-not ($del -contains (Name (Get-Date '2026-09-12 08:00')))) 'keeps the first backup of September'
Assert ($del -contains (Name (Get-Date '2026-09-13 08:00'))) 'deletes 13 September'
Assert (-not ($del -contains 'notes.txt')) 'never deletes files with another name'

$old = @((Name (Get-Date '2025-10-05 09:00')), (Name (Get-Date '2025-11-03 09:00')), (Name (Get-Date '2025-11-20 09:00')))
$del = Get-BackupsToDelete ($old + $daily) $now 30 12
Assert ($del -contains $old[0]) 'drops months older than 12'
Assert (-not ($del -contains $old[1])) 'keeps first backup of a month within 12 months'
Assert ($del -contains $old[2]) 'drops later backups of an old month'
Assert ((Get-BackupsToDelete @($daily[0..4]) $now 30 12).Count -eq 0) 'deletes nothing when fewer than keepDaily'

Write-Host 'Log masking'
$secretPw = 'FakePw-123'
$masked = Protect-LogText "connect postgresql://postgres.abcd:$secretPw@aws-0-eu.pooler.supabase.com:5432/postgres failed"
Assert ($masked -notmatch $secretPw) 'masks the password inside a URL'
Assert ((Protect-LogText "password=$secretPw x") -notmatch $secretPw) 'masks password=...'
Assert ((Protect-LogText 'AGE-SECRET-KEY-1QQQFAKEFAKEFAKE') -notmatch 'FAKEFAKE') 'masks an age private key'
Assert ((Protect-LogText '{"access_token":"ya29.fake","x":1}') -notmatch 'ya29') 'masks a Drive token'

Write-Host 'Connection string'
$db = ConvertFrom-DbUrl 'postgresql://postgres.abcd:p%40ss:w0rd@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
Assert ($db.Password -eq 'p@ss:w0rd') 'decodes the password'
Assert ($db.ConnInfo -notmatch 'w0rd') 'conninfo has no password'
Assert ($db.ConnInfo -match 'sslmode=require') 'Supabase host requires SSL'
Assert ($db.ConnInfo -match "user='postgres.abcd'") 'keeps the pooler user name'
Assert ($db.Port -eq 5432 -and $db.Host -eq 'aws-0-eu-central-1.pooler.supabase.com') 'host and port'
$db = ConvertFrom-DbUrl 'postgresql://postgres:pa@ss@127.0.0.1:54321/postgres'
Assert ($db.Password -eq 'pa@ss' -and $db.Host -eq '127.0.0.1') 'unencoded @ in the password'
Assert ($db.ConnInfo -match 'sslmode=prefer') 'local host prefers SSL only'
$bad = $false; try { ConvertFrom-DbUrl 'not a url' | Out-Null } catch { $bad = $true }
Assert $bad 'rejects a bad URL'

Write-Host 'Argument quoting'
Assert ((ConvertTo-ArgString @('-c', 'a b', 'x"y', 'C:\p q\')) -eq '-c "a b" "x\"y" "C:\p q\\"') 'quotes spaces, quotes and trailing backslash'

Write-Host 'DPAPI secret'
Save-DbSecret (ConvertTo-SecureString 'postgresql://u:FakeSecret@h:5432/d' -AsPlainText -Force)
Assert ((Get-DbUrl) -eq 'postgresql://u:FakeSecret@h:5432/d') 'round-trips'
Assert (([IO.File]::ReadAllText($script:Paths.Secret)) -notmatch 'FakeSecret') 'file is not plain text'

# ---- Tool installation helpers (install-tools.ps1 uses the same functions) ----

# A zip built in memory from @{ 'entry/name' = 'text' }; entry names are stored exactly as given.
function New-TestZipBytes([Collections.IDictionary]$Entries) {
  $ms = New-Object IO.MemoryStream
  $zip = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Create, $true)
  foreach ($k in $Entries.Keys) {
    $w = New-Object IO.StreamWriter($zip.CreateEntry($k).Open())
    $w.Write([string]$Entries[$k]); $w.Dispose()
  }
  $zip.Dispose()
  return , $ms.ToArray()
}
function Open-TestZip([byte[]]$Bytes) {
  return New-Object IO.Compression.ZipArchive((New-Object IO.MemoryStream(, $Bytes)), [IO.Compression.ZipArchiveMode]::Read)
}
function Get-BytesSha256([byte[]]$Bytes) {
  $s = New-Object IO.MemoryStream(, $Bytes)
  try { return Get-StreamSha256 $s } finally { $s.Dispose() }
}
# True when the block throws (and, with $Like, when the message matches it).
function Test-Throws([scriptblock]$Block, [string]$Like = '*') { try { & $Block | Out-Null; return $false } catch { return ($_.Exception.Message -like $Like) } }
function Get-FileCount([string]$Dir) { @(Get-ChildItem -LiteralPath $Dir -Recurse -Force -File -ErrorAction SilentlyContinue).Count }

Write-Host 'Zip entry guard'
$sb = Join-Path $env:DOLPHIN_BACKUP_HOME 'guard'
$root = Join-Path $sb 'tools'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$absolute = Join-Path $sb 'abs-evil.txt'
$driveRootEvil = Join-Path ([IO.Path]::GetPathRoot($root)) 'evil.txt'
# entry name -> the file it would create if the guard let it through ($null: not probed, e.g. a network path)
$bad = [ordered]@{
  '../evil.txt'                       = (Join-Path $sb 'evil.txt')
  '..\evil.txt'                       = (Join-Path $sb 'evil.txt')
  'sub/../../evil.txt'                = (Join-Path $sb 'evil.txt')
  '../tools2/x.txt'                   = (Join-Path $sb 'tools2\x.txt')   # sibling folder whose name starts with "tools"
  $absolute                           = $absolute
  ($absolute -replace '\\', '/')      = $absolute
  '\evil.txt'                         = $driveRootEvil
  '/evil.txt'                         = $driveRootEvil
  '\\srv\share\x'                     = $null
  '//srv/share/x'                     = $null
  'x.txt:ads'                         = (Join-Path $root 'x.txt')
  'C:evil.txt'                        = $null
  'bin/..'                            = $root
  '.'                                 = $root
}
$names = [ordered]@{}; foreach ($k in $bad.Keys) { $names[$k] = 'evil' }
$zip = Open-TestZip (New-TestZipBytes $names)
try {
  Assert ($zip.Entries.Count -eq $bad.Count) "test zip holds all $($bad.Count) bad names"
  foreach ($e in $zip.Entries) {
    Assert (Test-Throws { Export-ZipEntry $e $root $e.FullName } 'unsafe path*') "rejects zip entry '$($e.FullName)'"
    if ($bad[$e.FullName]) { Assert (-not (Test-Path -LiteralPath $bad[$e.FullName] -PathType Leaf)) "  nothing written for '$($e.FullName)'" }
  }
} finally { $zip.Dispose() }
Assert ((Get-FileCount $sb) -eq 0) 'no file written anywhere by rejected entries'
Assert (-not (Test-Path (Join-Path $sb 'tools2'))) 'no sibling folder created'

Write-Host 'Zip guard is rooted at the matched folder'
$zip = Open-TestZip (New-TestZipBytes ([ordered]@{ 'ok/good.txt' = 'good'; 'pgsql/bin/../../rclone/rclone.exe' = 'evil' }))
try {
  Export-ZipEntry $zip.GetEntry('ok/good.txt') $root 'ok/good.txt'
  Assert ([IO.File]::ReadAllText((Join-Path $root 'ok\good.txt')) -eq 'good') 'extracts a normal entry'
  $stageBin = Join-Path $sb '.staging-pgsql\bin'
  Assert (Test-Throws { Export-ZipEntry $zip.GetEntry('pgsql/bin/../../rclone/rclone.exe') $stageBin '../../rclone/rclone.exe' } 'unsafe path*') 'rejects bin/../../rclone/rclone.exe'
  Assert (-not (Test-Path (Join-Path $sb 'rclone'))) '  rclone folder not written'
} finally { $zip.Dispose() }

$pg = @{ Name = 'pgsql'; ZipRoot = 'pgsql/'; Folders = @('bin', 'lib') }
$stage = Join-Path $sb '.staging-pgsql2'
foreach ($evil in @('pgsql/bin/../../rclone/rclone.exe', 'pgsql/bin/../lib/x.dll')) {
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $zip = Open-TestZip (New-TestZipBytes ([ordered]@{ 'pgsql/bin/pg_dump.exe' = 'fake'; $evil = 'evil' }))
  try { Assert (Test-Throws { Expand-ToolPackage $zip $pg $stage } 'unsafe path*') "package extraction rejects '$evil'" } finally { $zip.Dispose() }
  Assert (-not (Test-Path (Join-Path $sb 'rclone')) -and -not (Test-Path (Join-Path $stage 'lib\x.dll'))) '  the escaping entry was not written'
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$zip = Open-TestZip (New-TestZipBytes ([ordered]@{ 'pgsql/bin/' = ''; 'pgsql/bin/a.exe' = 'a'; 'pgsql/lib/b.dll' = 'b'; 'pgsql/doc/c.txt' = 'c'; 'pgsql/binx/d.exe' = 'd' }))
try { $n = Expand-ToolPackage $zip $pg $stage } finally { $zip.Dispose() }
Assert ($n -eq 2 -and (Test-Path (Join-Path $stage 'bin\a.exe')) -and (Test-Path (Join-Path $stage 'lib\b.dll'))) "extracts only the listed folders ($n files)"
Assert (-not (Test-Path (Join-Path $stage 'doc')) -and -not (Test-Path (Join-Path $stage 'binx'))) '  other folders are skipped'
$zip = Open-TestZip (New-TestZipBytes ([ordered]@{ 'age/age.exe' = 'a' }))
try { Assert (Test-Throws { Expand-ToolPackage $zip @{ Name = 'age'; Files = @{ 'age/age-keygen.exe' = 'age-keygen.exe' } } $stage } 'missing*') 'a missing listed file is an error' } finally { $zip.Dispose() }

Write-Host 'rclone SHA256SUMS parser'
$file = 'rclone-v1.75.2-windows-amd64.zip'
$sums = @(
  '-----BEGIN PGP SIGNED MESSAGE-----', 'Hash: SHA1', '',
  (('1' * 64) + '  rclone-v1.75.2-windows-amd64.zip.sig'),
  (('2' * 64) + '  my-rclone-v1.75.2-windows-amd64.zip'),
  (('3' * 64) + '  rclone-v1.75.2-windows-arm64.zip'),
  (('A' * 64) + '  rclone-v1.75.2-windows-amd64.zip'),
  (('5' * 64) + '  rclone-v1.75.2-windows-amd64.zip.extra'),
  (('6' * 64) + '  rclone-v1.75.2-windows-386.zip'),
  (('9' * 64) + '  RCLONE-V1.75.2-WINDOWS-AMD64.ZIP'),
  '-----BEGIN PGP SIGNATURE-----', 'iQEzBAEBCAAdFiEE', '-----END PGP SIGNATURE-----'
) -join "`r`n"
Assert ((Get-RcloneOfficialSha256 $sums $file) -eq ('a' * 64)) 'returns only the exact file name, case-sensitive (hash in lower case)'
Assert ((Get-RcloneOfficialSha256 (('B' * 64) + ' *' + $file + "`n") $file) -eq ('b' * 64)) 'accepts the binary-mode marker *'
Assert (Test-Throws { Get-RcloneOfficialSha256 ($sums -replace 'windows-amd64\.zip\r', 'windows-amd64.zip.old') $file }) 'no exact line: error'
Assert (Test-Throws { Get-RcloneOfficialSha256 '' $file }) 'empty text: error'
Assert (Test-Throws { Get-RcloneOfficialSha256 ($sums + "`r`n" + ('7' * 64) + '  ' + $file) $file }) 'two different hashes for the file: error'
Assert (Test-Throws { Get-RcloneOfficialSha256 (('8' * 63) + '  ' + $file) $file }) 'a short hash is not accepted'

Write-Host 'Install markers'
$age = $script:ToolPackages['age']
$ageDir = Join-Path $script:ToolsDir 'age'
New-Item -ItemType Directory -Force -Path $ageDir | Out-Null
foreach ($f in 'age.exe', 'age-keygen.exe') { [IO.File]::WriteAllText((Join-Path $ageDir $f), 'fake') }
$marker = Join-Path $ageDir '.installed'
Assert (-not (Test-ToolsInstalled @('Age'))) 'exe without a marker: not installed'
Write-JsonFile $marker ([ordered]@{ name = 'age'; version = $age.Version; sha256 = $age.Sha256 })
Assert (Test-ToolsInstalled @('Age', 'AgeKeygen')) 'exe + marker with the pinned hash: installed'
Assert (-not (Test-ToolsInstalled @('Age', 'Rclone'))) 'another tool still missing: not installed'
Assert (-not (Test-ToolsInstalled @('NoSuchTool'))) 'unknown tool name: not installed'
Write-JsonFile $marker ([ordered]@{ name = 'age'; version = $age.Version; sha256 = ('0' * 64) })
Assert (-not (Test-ToolsInstalled @('Age'))) 'marker with a wrong hash: not installed'
Write-JsonFile $marker ([ordered]@{ name = 'age'; version = '0.0.1'; sha256 = $age.Sha256 })
Assert (-not (Test-ToolsInstalled @('Age'))) 'marker with another version: not installed'
[IO.File]::WriteAllText($marker, '{ broken')
Assert (-not (Test-ToolsInstalled @('Age'))) 'unreadable marker: not installed'
Write-JsonFile $marker ([ordered]@{ name = 'age'; version = $age.Version; sha256 = $age.Sha256 })
Remove-Item (Join-Path $ageDir 'age-keygen.exe')
Assert (-not (Test-ToolsInstalled @('Age'))) 'marker but a program of the package missing: not installed'
Remove-Item -LiteralPath $ageDir -Recurse -Force

Write-Host 'Interrupted install resumes (fake package, offline)'
$fakeZip = New-TestZipBytes ([ordered]@{ 'fake/fake.exe' = 'FAKE-EXE-v1'; 'fake/LICENSE' = 'fake licence'; 'fake/README' = 'not extracted' })
$fakeHash = Get-BytesSha256 $fakeZip
$script:ToolPackages['fake'] = @{ Name = 'fake'; Version = '1.0'; Url = 'https://example.invalid/fake-tool.zip'; Sha256 = $fakeHash
  Files = [ordered]@{ 'fake/fake.exe' = 'fake.exe'; 'fake/LICENSE' = 'LICENSE' } }
$script:Tools['Fake'] = Join-Path $script:ToolsDir 'fake\fake.exe'
$script:ToolPackageOf['Fake'] = 'fake'
$fakeDir = Join-Path $script:ToolsDir 'fake'
$fakeStage = Join-Path $script:ToolsDir '.staging-fake'
$cached = Join-Path $script:DownloadsDir 'fake\fake-tool.zip'
New-Item -ItemType Directory -Force -Path (Split-Path $cached), $fakeDir, $fakeStage | Out-Null
[IO.File]::WriteAllBytes($cached, $fakeZip)
# State after an interrupted run: a partial tool folder without a marker and a leftover staging folder.
[IO.File]::WriteAllText((Join-Path $fakeDir 'fake.exe'), 'PARTIAL')
[IO.File]::WriteAllText((Join-Path $fakeDir 'stale.txt'), 'old')
[IO.File]::WriteAllText((Join-Path $fakeStage 'junk.txt'), 'junk')
Assert (-not (Test-ToolsInstalled @('Fake'))) 'partial folder without a marker: not installed'
$err = $null; try { Install-ToolPackage $script:ToolPackages['fake'] $fakeHash | Out-Null } catch { $err = $_.Exception.Message }
Assert ($null -eq $err) "next install run completes ($err)"
Assert (Test-ToolsInstalled @('Fake')) '  Test-ToolsInstalled is true'
Assert ([IO.File]::ReadAllText((Join-Path $fakeDir 'fake.exe')) -eq 'FAKE-EXE-v1') '  the program is the one from the zip'
Assert (-not (Test-Path (Join-Path $fakeDir 'stale.txt')) -and -not (Test-Path (Join-Path $fakeDir 'README'))) '  the old partial folder was replaced'
Assert (-not (Test-Path $fakeStage)) '  the staging folder was removed'
Assert ((Read-JsonFile (Join-Path $fakeDir '.installed')).sha256 -eq $fakeHash) '  the marker holds the verified hash'
Assert ((Test-Path $cached) -and ((Get-BytesSha256 ([IO.File]::ReadAllBytes($cached))) -eq $fakeHash)) '  the cached zip was kept unchanged'

Write-JsonFile (Join-Path $fakeDir '.installed') ([ordered]@{ name = 'fake'; version = '1.0'; sha256 = ('0' * 64) })
Assert (-not (Test-ToolsInstalled @('Fake'))) 'marker with a wrong hash: not installed'
Install-ToolPackage $script:ToolPackages['fake'] $fakeHash | Out-Null
Assert (Test-ToolsInstalled @('Fake')) '  reinstalled on the next run'

New-Item -ItemType Directory -Force -Path $fakeStage | Out-Null
[IO.File]::WriteAllText((Join-Path $fakeStage 'junk.txt'), 'junk')
$r = Install-ToolPackage $script:ToolPackages['fake'] $fakeHash
Assert ((Test-ToolsInstalled @('Fake')) -and -not (Test-Path $fakeStage)) "leftover staging next to a good install is removed ($r)"
Assert (Test-Throws { Install-ToolPackage $script:ToolPackages['fake'] '' } '*not a 64-character hash*') 'an empty expected hash is refused'

Write-Host 'A package cannot overwrite another tool'
$evilZip = New-TestZipBytes ([ordered]@{ 'evil/bin/ok.exe' = 'ok'; 'evil/bin/../../fake/fake.exe' = 'EVIL' })
$evilHash = Get-BytesSha256 $evilZip
$script:ToolPackages['evil'] = @{ Name = 'evil'; Version = '1.0'; Url = 'https://example.invalid/evil.zip'; Sha256 = $evilHash; ZipRoot = 'evil/'; Folders = @('bin') }
$evilCached = Join-Path $script:DownloadsDir 'evil\evil.zip'
New-Item -ItemType Directory -Force -Path (Split-Path $evilCached) | Out-Null
[IO.File]::WriteAllBytes($evilCached, $evilZip)
Assert (Test-Throws { Install-ToolPackage $script:ToolPackages['evil'] $evilHash } 'unsafe path*') 'install fails on evil/bin/../../fake/fake.exe'
Assert ([IO.File]::ReadAllText((Join-Path $fakeDir 'fake.exe')) -eq 'FAKE-EXE-v1') '  the other tool was not overwritten'
Assert (-not (Test-Path (Join-Path $script:ToolsDir 'evil')) -and -not (Test-Path (Join-Path $script:ToolsDir '.staging-evil'))) '  no folder or staging left for the bad package'
Assert (Test-Path $evilCached) '  a cached zip whose hash matched is not deleted'

# From here the pinned fake zip changes (v1 -> v2) while v1 stays installed.
$script:MoveRetries = 2; $script:MoveRetryDelayMs = 50
$hashV1 = $fakeHash
$fakeZipV2 = New-TestZipBytes ([ordered]@{ 'fake/fake.exe' = 'FAKE-EXE-v2'; 'fake/LICENSE' = 'fake licence v2' })
$hashV2 = Get-BytesSha256 $fakeZipV2
[IO.File]::WriteAllBytes($cached, $fakeZipV2)
$script:ToolPackages['fake'].Sha256 = $hashV2
$fakeOld = Join-Path $script:ToolsDir '.old-fake'
function Test-OldFakeIntact([string]$Label) {
  Assert ((Test-ToolPackageInstalled 'fake' $hashV1) -and ([IO.File]::ReadAllText((Join-Path $fakeDir 'fake.exe')) -eq 'FAKE-EXE-v1')) "  ${Label}: the old install is still complete and valid"
  Assert (-not (Test-Path $fakeOld)) "  ${Label}: no .old-fake folder left"
}

Write-Host 'Files missing from staging (e.g. deleted by a second install): no marker'
$hooks = [ordered]@{
  'one file deleted' = { param($Step, $Dir) if ($Step -eq 'extracted') { Remove-Item -LiteralPath (Join-Path $Dir 'LICENSE') } }
  'staging deleted, then partly re-created' = { param($Step, $Dir) if ($Step -eq 'extracted') {
      Remove-Item -LiteralPath $Dir -Recurse -Force; [void][IO.Directory]::CreateDirectory($Dir); [IO.File]::WriteAllText((Join-Path $Dir 'fake.exe'), 'x') } }
}
foreach ($k in $hooks.Keys) {
  Assert (Test-Throws { Install-ToolPackage $script:ToolPackages['fake'] $hashV2 -TestHook $hooks[$k] } '*staging*') "${k}: install fails"
  Assert (-not (Test-ToolsInstalled @('Fake'))) "  ${k}: not installed with the new hash"
  Assert (-not (Test-Path $fakeStage)) "  ${k}: staging folder removed"
  Test-OldFakeIntact $k
}

Write-Host 'A file of the old install is open (locked DLL, antivirus): the old install is kept'
$held = New-Object IO.FileStream((Join-Path $fakeDir 'fake.exe'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try { Assert (Test-Throws { Install-ToolPackage $script:ToolPackages['fake'] $hashV2 }) 'install fails while the old folder cannot be moved' }
finally { $held.Dispose() }
Assert (-not (Test-Path $fakeStage)) '  staging folder removed'
Test-OldFakeIntact 'old file locked'

Write-Host 'A file of the new folder is open: the old install is put back'
$script:heldNew = $null
$lockNew = { param($Step, $Dir) if ($Step -eq 'ready') {
    $script:heldNew = New-Object IO.FileStream((Join-Path $Dir 'fake.exe'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) } }
try { Assert (Test-Throws { Install-ToolPackage $script:ToolPackages['fake'] $hashV2 -TestHook $lockNew }) 'install fails while the new folder cannot be moved into place' }
finally { if ($script:heldNew) { $script:heldNew.Dispose() } }
Test-OldFakeIntact 'new file locked'

Write-Host 'Without locks the next run installs the new zip'
$r = Install-ToolPackage $script:ToolPackages['fake'] $hashV2
Assert ((Test-ToolsInstalled @('Fake')) -and ([IO.File]::ReadAllText((Join-Path $fakeDir 'fake.exe')) -eq 'FAKE-EXE-v2')) "new version installed ($r)"
Assert (-not (Test-Path $fakeStage) -and -not (Test-Path $fakeOld)) '  no staging or .old folder left'

Write-Host 'Leftovers of other runs are cleaned'
foreach ($d in '.old-fake', '.old-age', '.staging-gone') {
  New-Item -ItemType Directory -Force -Path (Join-Path $script:ToolsDir "$d\sub") | Out-Null
  [IO.File]::WriteAllText((Join-Path $script:ToolsDir "$d\sub\f.txt"), 'x')
}
Clear-ToolLeftovers
Assert (@(Get-ChildItem -LiteralPath $script:ToolsDir -Force -Directory | Where-Object { $_.Name -like '.old-*' -or $_.Name -like '.staging-*' }).Count -eq 0) 'every .old-* and .staging-* folder removed'
Assert (Test-ToolsInstalled @('Fake')) '  installed tools are kept'

Write-Host 'install-tools.ps1 arguments'
$installer = Join-Path $PSScriptRoot '..\install-tools.ps1'
$err = $null; try { & $installer -Only 'nosuch' *> $null } catch { $err = $_.Exception.Message }
Assert ($err -like '*unknown*nosuch*') "unknown -Only name is an error ($err)"
$savedHome = $env:DOLPHIN_BACKUP_HOME
Remove-Item Env:\DOLPHIN_BACKUP_HOME
# -Only nosuch keeps this call harmless even if the check were missing (tools and downloads still point to temp).
$err = $null; try { & $installer -Only 'nosuch' -TestExpectedSha256 @{ age = ('0' * 64) } *> $null } catch { $err = $_.Exception.Message }
$env:DOLPHIN_BACKUP_HOME = $savedHome
Assert ($err -like '*TestExpectedSha256*test*') "hash override refused outside test mode ($err)"
$err = $null; try { & $installer -Only 'nosuch' -TestExpectedSha256 @{ nosuch = ('0' * 64) } *> $null } catch { $err = $_.Exception.Message }
Assert ($err -like '*unknown*nosuch*') "hash override for an unknown package is an error ($err)"

Write-Host 'install-tools and run-backup share one lock'
$lock = Get-BackupLock
Assert ($null -ne $lock) 'the test takes the backup lock'
# Another process (a second double-click, or a running backup) holds the lock.
try { $r = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-Only', 'nosuch') }
finally { Exit-BackupLock $lock }
$text = $r.StdErr + $r.StdOut
Assert ($r.ExitCode -ne 0 -and $text -match 'DolphinLabBackup' -and $text -notmatch 'unknown') "install-tools refuses while the lock is held (exit $($r.ExitCode))"
# A process holding the lock is killed. The lock only stays "abandoned" while another
# handle keeps it alive (here $keep, in real life e.g. a second waiting process).
$keep = New-Object System.Threading.Mutex($false, $script:LockName)
$psi = New-Object System.Diagnostics.ProcessStartInfo 'powershell.exe'
$psi.Arguments = "-NoProfile -Command `"`$m = New-Object Threading.Mutex(`$false, '$($script:LockName)'); [void]`$m.WaitOne(0); [Console]::Out.WriteLine('held'); Start-Sleep 60`""
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.CreateNoWindow = $true
$holder = [System.Diagnostics.Process]::Start($psi)
try {
  Assert ($holder.StandardOutput.ReadLine() -eq 'held') 'a second process holds the lock'
  Assert ($null -eq (Get-BackupLock)) '  the lock cannot be taken meanwhile'
} finally { $holder.Kill(); $holder.WaitForExit() }
$err = $null; $lock = $null
try { $lock = Get-BackupLock } catch { $err = $_.Exception.Message }
Assert ($null -ne $lock) "the lock of the killed process (abandoned) is taken over ($err)"
Exit-BackupLock $lock
$keep.Dispose()

Remove-Item $env:DOLPHIN_BACKUP_HOME -Recurse -Force
if ($script:failures) { Write-Host "$($script:failures) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All unit tests passed'
