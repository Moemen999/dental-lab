# Negative test for install-tools.ps1: a wrong expected hash must stop the
# install, delete the downloaded zip and leave no extracted program.
# Then: the real age zip installs with a marker, and an interrupted install
# (no marker, leftover staging folder) is completed by the next run.
# Downloads age (~20 MB) and the rclone SHA256SUMS from the internet into a new
# empty temp folder, which is deleted at the end. Fake values only.
$home2 = Join-Path ([IO.Path]::GetTempPath()) ('dolphin-verify-' + [guid]::NewGuid().ToString('N'))
$env:DOLPHIN_BACKUP_HOME = $home2
$env:DOLPHIN_BACKUP_TOOLS = Join-Path $home2 'tools'
$env:DOLPHIN_BACKUP_DOWNLOADS = Join-Path $home2 'downloads'
$env:DOLPHIN_BACKUP_QUIET = '1'
. (Join-Path $PSScriptRoot '..\common.ps1')
$installer = Join-Path $PSScriptRoot '..\install-tools.ps1'
$wrong = '0' * 64
$ageDir = Join-Path $env:DOLPHIN_BACKUP_TOOLS 'age'
$ageStage = Join-Path $env:DOLPHIN_BACKUP_TOOLS '.staging-age'
$ageZip = Join-Path $home2 'downloads\age\age-v1.3.2-windows-amd64.zip'

$script:failures = 0
function Assert([bool]$Cond, [string]$Label) {
  if ($Cond) { Write-Host "  ok   $Label" } else { Write-Host "  FAIL $Label" -ForegroundColor Red; $script:failures++ }
}
function Invoke-Install([hashtable]$Override, [string]$Name) {
  try { & $installer -Only $Name -TestExpectedSha256 $Override *> $null; return $null } catch { return $_.Exception.Message }
}

try {
  Write-Host 'Wrong hash for age'
  $err = Invoke-Install @{ age = $wrong } 'age'
  Assert ($err -like 'SHA-256 mismatch for age*') "install fails with a hash error ($err)"
  Assert (-not (Test-Path (Join-Path $env:DOLPHIN_BACKUP_TOOLS 'age\age.exe'))) 'no age.exe was extracted'
  Assert (-not (Test-Path $ageStage) -and -not (Test-Path (Join-Path $ageDir '.installed'))) 'no staging folder and no marker'
  Assert (-not (Test-Path $ageZip)) 'the unverified zip was deleted'

  Write-Host 'Pinned rclone hash differs from the official SHA256SUMS'
  $err = Invoke-Install @{ rclone = $wrong } 'rclone'
  Assert ($err -like '*official SHA256SUMS*') "install fails before downloading ($err)"
  Assert (-not (Test-Path (Join-Path $home2 'downloads\rclone\rclone-v1.75.2-windows-amd64.zip'))) 'rclone zip was not downloaded'
  Assert (-not (Test-Path (Join-Path $env:DOLPHIN_BACKUP_TOOLS 'rclone\rclone.exe'))) 'no rclone.exe was extracted'

  Write-Host 'Correct pinned hash for age'
  $err = Invoke-Install @{} 'age'
  Assert ($null -eq $err) "install succeeds ($err)"
  Assert (Test-Path (Join-Path $env:DOLPHIN_BACKUP_TOOLS 'age\age.exe')) 'age.exe extracted after the hash matched'
  Assert (Test-ToolsInstalled @('Age', 'AgeKeygen')) 'marker written: Test-ToolsInstalled is true'
  Assert (-not (Test-Path $ageStage)) 'no staging folder left'

  Write-Host 'Interrupted install of age (offline, uses the kept zip)'
  $zipTime = (Get-Item $ageZip).LastWriteTimeUtc
  Remove-Item (Join-Path $ageDir '.installed')
  Remove-Item (Join-Path $ageDir 'age-keygen.exe')
  New-Item -ItemType Directory -Force -Path $ageStage | Out-Null
  [IO.File]::WriteAllText((Join-Path $ageStage 'age.exe'), 'half written')
  Assert (-not (Test-ToolsInstalled @('Age'))) 'partial folder without a marker: not installed'
  $err = Invoke-Install @{} 'age'
  Assert ($null -eq $err -and (Test-ToolsInstalled @('Age', 'AgeKeygen'))) "next run completes the install ($err)"
  Assert (-not (Test-Path $ageStage)) 'leftover staging folder removed'
  Assert ((Get-Item $ageZip).LastWriteTimeUtc -eq $zipTime) 'the kept zip was reused, not downloaded again'

  Write-Host 'Marker with a wrong hash'
  Write-JsonFile (Join-Path $ageDir '.installed') ([ordered]@{ name = 'age'; version = '1.3.2'; sha256 = $wrong })
  Assert (-not (Test-ToolsInstalled @('Age'))) 'treated as not installed'
  $err = Invoke-Install @{} 'age'
  Assert ($null -eq $err -and (Test-ToolsInstalled @('Age', 'AgeKeygen'))) "reinstalled by the next run ($err)"
} finally {
  Remove-Item $home2 -Recurse -Force -ErrorAction SilentlyContinue
}
if ($script:failures) { Write-Host "$($script:failures) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All install verification tests passed'
