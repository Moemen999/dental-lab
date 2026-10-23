# =============================================================================
# Dolphin lab backup: one-time setup on the lab PC (run by the owner, not by an agent).
# Start it with setup-backup.cmd (double-click). It:
#   1. installs the tools (install-tools.ps1) if missing
#   2. asks for the Supabase Session pooler connection string in a hidden field
#      and stores it encrypted with Windows DPAPI (never shown, never logged)
#   3. creates the encryption key pair: the PUBLIC key stays on the PC, the
#      PRIVATE key is saved on the Desktop for the owner to move to a USB stick
#      and print, then delete from the PC
#   4. connects Google Drive through rclone (the owner logs in in the browser)
#   5. limits the backup folder to this Windows user, copies the scripts,
#      creates the scheduled task and the desktop shortcuts
# Re-run single parts with -SkipDatabase / -SkipKey / -SkipDrive / -SkipSchedule.
# =============================================================================
param(
  [switch]$SkipDatabase,
  [switch]$SkipKey,
  [switch]$SkipDrive,
  [switch]$SkipSchedule
)

. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$TaskName = 'DolphinLabBackup'
$RemoteName = 'dolphin-drive'
$DriveFolder = 'DolphinLabBackups'

function Show-Question([string]$Text) {
  $opts = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign
  $r = [System.Windows.Forms.MessageBox]::Show($Text, $script:Msg.Title, [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $opts)
  return $r -eq [System.Windows.Forms.DialogResult]::Yes
}

# Small right-to-left form with one text box per field; $Masked hides the typed text.
function Show-InputForm([string]$Heading, [string[]]$Labels, [bool[]]$Masked) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $script:Msg.Title
  $form.RightToLeft = 'Yes'; $form.RightToLeftLayout = $true
  $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false; $form.MinimizeBox = $false; $form.TopMost = $true
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $form.ClientSize = New-Object System.Drawing.Size(560, (110 + 60 * $Labels.Count))
  $head = New-Object System.Windows.Forms.Label
  $head.Text = $Heading; $head.SetBounds(16, 12, 528, 44)
  $form.Controls.Add($head)
  $boxes = @()
  for ($i = 0; $i -lt $Labels.Count; $i++) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $Labels[$i]; $l.SetBounds(16, 60 + 60 * $i, 528, 22)
    $t = New-Object System.Windows.Forms.TextBox
    $t.SetBounds(16, 84 + 60 * $i, 528, 26); $t.RightToLeft = 'No'
    if ($Masked[$i]) { $t.UseSystemPasswordChar = $true }
    $form.Controls.Add($l); $form.Controls.Add($t); $boxes += $t
  }
  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'حفظ'; $ok.DialogResult = 'OK'; $ok.SetBounds(16, $form.ClientSize.Height - 44, 120, 32)
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'إلغاء'; $cancel.DialogResult = 'Cancel'; $cancel.SetBounds(144, $form.ClientSize.Height - 44, 120, 32)
  $form.Controls.Add($ok); $form.Controls.Add($cancel)
  $form.AcceptButton = $ok; $form.CancelButton = $cancel
  if ($form.ShowDialog() -ne 'OK') { return $null }
  return ,@($boxes | ForEach-Object { $_.Text.Trim() })
}

function Save-Config($Config) { Write-JsonFile $script:Paths.Config $Config }

Initialize-BackupHome
$config = Get-BackupConfig
if (-not $config) { $config = [pscustomobject]@{ remote = ''; recipient = '' } }

# 1. Tools
if (-not (Test-ToolsInstalled @('Rclone', 'Age', 'AgeKeygen', 'PgDump', 'PgRestore', 'Psql', 'InitDb', 'PgCtl'))) {
  try { & (Join-Path $PSScriptRoot 'install-tools.ps1') }
  catch {
    Write-BackupLog ('install-tools failed: ' + $_.Exception.Message)
    Show-OwnerMessage ("تعذّر تنزيل البرامج أو التأكد من سلامتها، ولم يتم تشغيل أي برنامج منها.`nتأكد من الإنترنت وجرّب مرة تانية.`n`n" + $_.Exception.Message) -IsError
    exit 1
  }
}

# 2. Database connection string
if (-not $SkipDatabase) {
  while ($true) {
    $v = Show-InputForm ("الصق رابط الاتصال بقاعدة البيانات من Supabase:`nConnect ← Session pooler (المنفذ 5432). الرابط لن يظهر ولن يُحفظ إلا مشفرًا.") @('رابط الاتصال (postgresql://...)') @($true)
    if (-not $v) { exit 1 }
    try {
      $db = ConvertFrom-DbUrl $v[0]
      $r = Invoke-Native $script:Tools.Psql @('--no-psqlrc', '-X', '-At', '-d', $db.ConnInfo, '-c', 'SELECT count(*) FROM public.cases') (Get-PgEnv $db)
      if ($r.ExitCode -ne 0) { throw (Protect-LogText $r.StdErr) }
      Save-DbSecret (ConvertTo-SecureString $v[0] -AsPlainText -Force)
      $v = $null
      Show-OwnerMessage ('تم الاتصال بقاعدة البيانات بنجاح وحفظ الرابط مشفرًا. عدد الحالات: {0}' -f $r.StdOut.Trim())
      break
    } catch {
      Write-BackupLog ('إعداد: فشل الاتصال: ' + $_.Exception.Message)
      Show-OwnerMessage ("فشل الاتصال بقاعدة البيانات. تأكد من الرابط وكلمة المرور ثم حاول مرة أخرى.`n`n" + (Protect-LogText $_.Exception.Message)) -IsError
    }
  }
}

# 3. Encryption keys
if (-not $SkipKey -and (-not $config.recipient -or (Show-Question 'يوجد مفتاح تشفير بالفعل. هل تريد إنشاء مفتاح جديد؟ (النسخ القديمة ستحتاج المفتاح القديم)'))) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $keyFile = Join-Path $desktop ('مفتاح-استرجاع-نسخ-دولفين-{0}.txt' -f (Get-Date -Format 'yyyyMMdd'))
  if (Test-Path $keyFile) { throw "الملف موجود بالفعل: $keyFile" }
  $r = Invoke-Native $script:Tools.AgeKeygen @('-o', $keyFile)
  if ($r.ExitCode -ne 0) { throw $r.StdErr }
  $recipient = (Invoke-Native $script:Tools.AgeKeygen @('-y', $keyFile)).StdOut.Trim()
  $config.recipient = $recipient
  Save-Config $config
  Show-OwnerMessage (@"
تم إنشاء مفتاح الاسترجاع على سطح المكتب:
$keyFile

مهم جدًا:
1) انسخ هذا الملف على فلاشة واحفظها في مكان آمن خارج المعمل.
2) اطبع محتوى الملف واحفظ الورقة في مكان آمن.
3) بعد ذلك احذف الملف من هذا الجهاز.

بدون هذا المفتاح لا يمكن فتح أي نسخة احتياطية، ولا يستطيع أحد استرجاعه.
"@)
}

# 4. Google Drive
if (-not $SkipDrive) {
  $v = Show-InputForm ("بيانات Google OAuth client (من Google Cloud Console، نوع Desktop app).`nبعد الحفظ سيفتح المتصفح لتسجيل الدخول إلى Google Drive بنفسك.") @('Client ID', 'Client secret') @($false, $true)
  if (-not $v) { exit 1 }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:Tools.Rclone
  $psi.Arguments = ConvertTo-ArgString @('config', 'create', $RemoteName, 'drive', "client_id=$($v[0])", "client_secret=$($v[1])",
    'scope=drive.file', '--config', $script:Paths.Rclone)
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi); $p.WaitForExit()
  $v = $null
  if ($p.ExitCode -ne 0) { Show-OwnerMessage 'فشل ربط Google Drive. حاول مرة أخرى.' -IsError; exit 1 }
  $r = Invoke-Native $script:Tools.Rclone @('mkdir', "${RemoteName}:$DriveFolder", '--config', $script:Paths.Rclone)
  if ($r.ExitCode -ne 0) { Show-OwnerMessage ('فشل إنشاء مجلد على Google Drive: ' + (Protect-LogText $r.StdErr)) -IsError; exit 1 }
  $config.remote = "${RemoteName}:$DriveFolder"
  Save-Config $config
  Show-OwnerMessage "تم ربط Google Drive. النسخ ستُحفظ في المجلد: $DriveFolder"
}

# 5. Lock the folder to this user, copy scripts, schedule, shortcuts.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $script:BackupHome /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null

New-Item -ItemType Directory -Force -Path $script:Paths.App | Out-Null
foreach ($f in 'common.ps1', 'run-backup.ps1', 'restore-backup.ps1', 'restore-stub.sql', 'install-tools.ps1') {
  Copy-Item (Join-Path $PSScriptRoot $f) (Join-Path $script:Paths.App $f) -Force
}

if (-not $SkipSchedule) {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $runner = Join-Path $script:Paths.App 'run-backup.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
  $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $atLogon.Delay = 'PT2M'
  $midday = New-ScheduledTaskTrigger -Daily -At '13:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogon, $midday) -Settings $settings `
    -Principal $principal -Description 'Dolphin lab encrypted backup to Google Drive' -Force | Out-Null

  $shell = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $links = @(
    @{ Name = 'نسخة احتياطية الآن.lnk'; Args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Now" },
    @{ Name = 'اختبار استرجاع النسخة.lnk'; Args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $script:Paths.App 'restore-backup.ps1')`"" }
  )
  foreach ($l in $links) {
    $s = $shell.CreateShortcut((Join-Path $desktop $l.Name))
    $s.TargetPath = 'powershell.exe'
    $s.Arguments = $l.Args
    $s.WorkingDirectory = $script:Paths.App
    $s.IconLocation = 'shell32.dll,238'
    $s.Save()
  }
}

if (Show-Question 'تم الإعداد. هل تريد عمل أول نسخة احتياطية الآن؟') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:Paths.App 'run-backup.ps1') -Now
}
