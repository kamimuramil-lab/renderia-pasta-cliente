<#
  Cria (ou remove) uma tarefa agendada que abre o ThrottleStop ao logar, com privilegios de administrador,
  sem pedir UAC. Uso (PowerShell como Administrador):
    .\ThrottleStop-AutoStart.ps1 -Path "C:\ThrottleStop\ThrottleStop.exe"
    .\ThrottleStop-AutoStart.ps1 -Remove
#>
param([string]$Path, [switch]$Remove)
$Name = 'ThrottleStop AutoStart'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Execute como Administrador.' -ForegroundColor Red; exit 1 }
if ($Remove) { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host 'Tarefa removida.'; exit }
if (-not $Path -or -not (Test-Path $Path)) { Write-Host 'Informe -Path com o caminho do ThrottleStop.exe' -ForegroundColor Red; exit 1 }
$action    = New-ScheduledTaskAction -Execute $Path -WorkingDirectory (Split-Path $Path)
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $id.Name
$principal = New-ScheduledTaskPrincipal -UserId $id.Name -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Pronto: o ThrottleStop vai abrir ao logar. (Remover: -Remove)" -ForegroundColor Green
