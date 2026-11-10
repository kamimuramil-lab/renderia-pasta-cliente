<#
  Predator Optimizer - otimizador seguro e reversivel para notebooks Acer Predator (Windows 10/11)

  Filosofia:
   - NAO mexe em registro do sistema, servicos, drivers, pagefile, Defender ou BCD.
   - Nao usa "limpadores de RAM" (trim de working set piora o desempenho).
   - Tudo que altera e gravado em um backup e pode ser desfeito pelo menu (opcao 6).
   - Cria um ponto de restauracao antes de aplicar.
#>
param([switch]$Monitor)

$ErrorActionPreference = 'Stop'
$Base      = Join-Path $env:ProgramData 'PredatorOptimizer'
$BackupFile = Join-Path $Base 'backup.json'
$LogFile    = Join-Path $Base 'log.txt'
$null = New-Item -ItemType Directory -Force -Path $Base

$SUB_PROC      = '54533251-82be-4824-96c1-47b60b740d00'
$G_MAXSTATE    = 'bc5038f7-23e0-4960-96da-33abaf5935ec'
$G_MINSTATE    = '893dee8e-2bef-41e0-89c6-b55d0929964c'
$G_BOOSTMODE   = 'be337238-0d82-4146-a960-4f3749d470c7'
$G_COOLPOL     = '94d3a615-a899-4ac5-ae2b-e4d8f634367f'
$BALANCED      = '381b4222-f694-41f0-9685-ff5bb260df2e'
$PLAN_NAME     = 'Predator Optimizer'

function Log($m)  { "$(Get-Date -Format 's')  $m" | Add-Content -Path $LogFile -Encoding UTF8 }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Test-Admin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Load-Backup {
    if (Test-Path $BackupFile) { return (Get-Content $BackupFile -Raw | ConvertFrom-Json) }
    return $null
}
function Save-Backup($o) { $o | ConvertTo-Json -Depth 6 | Set-Content -Path $BackupFile -Encoding UTF8 }

# ---------------------------------------------------------------- leitura de sensores
function Get-CpuTempC {
    try {
        $t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
        $v = ($t | ForEach-Object { ($_.CurrentTemperature / 10) - 273.15 } | Measure-Object -Maximum).Maximum
        if ($v -gt 0 -and $v -lt 130) { return [math]::Round($v, 0) }
    } catch {}
    return $null
}
function Get-GpuInfo {
    $smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $smi) { $c = "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe"; if (Test-Path $c) { $smi = $c } }
    if (-not $smi) { return $null }
    try {
        $q = & $smi --query-gpu=name,temperature.gpu,utilization.gpu,power.draw,clocks_throttle_reasons.active --format=csv,noheader,nounits 2>$null
        $f = ($q | Select-Object -First 1) -split ',\s*'
        return [pscustomobject]@{ Name=$f[0]; Temp=[int]$f[1]; Util=[int]$f[2]; Power=$f[3]; ThrottleMask=$f[4] }
    } catch { return $null }
}
function Get-CpuPerf {
    $p = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    [pscustomobject]@{ Util = [int]$p.PercentProcessorUtility; FreqPct = [int]$p.PercentofMaximumFrequency; Perf = [int]$p.PercentProcessorPerformance }
}
function Get-RamInfo {
    $os = Get-CimInstance Win32_OperatingSystem
    $tot = $os.TotalVisibleMemorySize / 1MB; $free = $os.FreePhysicalMemory / 1MB
    $commitUsed = ($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB
    $commitMax  = $os.TotalVirtualMemorySize / 1MB
    [pscustomobject]@{
        TotalGB = [math]::Round($tot,1); UsedGB = [math]::Round($tot-$free,1)
        UsedPct = [int](100 * ($tot-$free) / $tot)
        CommitGB = [math]::Round($commitUsed,1); CommitMaxGB = [math]::Round($commitMax,1)
    }
}

# ---------------------------------------------------------------- 1) diagnostico (somente leitura)
function Show-Diagnostic {
    Say "`n=== DIAGNOSTICO (somente leitura, nada e alterado) ===" Cyan
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $gpus = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
    $bios = Get-CimInstance Win32_BIOS
    Say "Modelo : $($cs.Manufacturer) $($cs.Model)"
    Say "CPU    : $($cpu.Name)  ($($cpu.NumberOfCores) nucleos / $($cpu.NumberOfLogicalProcessors) threads, max $($cpu.MaxClockSpeed) MHz)"
    Say "GPU    : $($gpus -join ' | ')"
    Say "BIOS   : $($bios.SMBIOSBIOSVersion)  ($($bios.ReleaseDate.ToString('yyyy-MM-dd')))  -> confira se ha BIOS nova no site da Acer"
    $os = Get-CimInstance Win32_OperatingSystem
    Say "Windows: $($os.Caption) build $($os.BuildNumber)"

    Say "`n-- Energia / refrigeracao --" Yellow
    $active = (powercfg /getactivescheme) -join ' '
    Say "Plano ativo: $active"
    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    if ($bat) {
        $ac = if ($bat.BatteryStatus -in 2,3,6,7,8,9,11) { 'na tomada' } else { 'na bateria' }
        Say "Bateria: $($bat.EstimatedChargeRemaining)% ($ac)"
        if ($ac -eq 'na bateria') { Say "  ! Na bateria o Predator limita CPU/GPU. Para jogar/renderizar use sempre a tomada." Yellow }
    }
    $pm = Get-Process -Name 'PredatorSense','NitroSense' -ErrorAction SilentlyContinue
    if ($pm) { Say "PredatorSense: em execucao (use o modo Turbo/Auto e fan Auto/Max la dentro)" }
    else     { Say "PredatorSense: nao esta rodando (instale/abra para controlar os fans e o modo Turbo)" Yellow }

    Say "`n-- Temperatura / throttle agora --" Yellow
    $perf = Get-CpuPerf; $tmp = Get-CpuTempC; $gpu = Get-GpuInfo
    if ($perf) {
        Say "CPU uso: $($perf.Util)%   frequencia: $($perf.FreqPct)% do maximo   performance: $($perf.Perf)%"
        if ($perf.Util -gt 60 -and $perf.FreqPct -lt 60) { Say "  ! Carga alta e frequencia baixa = PROVAVEL THROTTLE (termico ou de energia)." Red }
    }
    if ($tmp) { Say "CPU temp (ACPI): $tmp C"; if ($tmp -ge 90) { Say "  ! Temperatura critica." Red } }
    else      { Say "CPU temp: indisponivel via Windows neste modelo (use HWiNFO64 ou PredatorSense para ver o valor real)" DarkYellow }
    if ($gpu) {
        Say "GPU ($($gpu.Name)): $($gpu.Temp) C, uso $($gpu.Util)%, $($gpu.Power) W"
        if ($gpu.Temp -ge 85) { Say "  ! GPU muito quente." Red }
    }

    Say "`n-- Memoria RAM --" Yellow
    $r = Get-RamInfo
    Say "RAM: $($r.UsedGB) / $($r.TotalGB) GB em uso ($($r.UsedPct)%)   Commit: $($r.CommitGB) / $($r.CommitMaxGB) GB"
    if ($r.UsedPct -gt 85) { Say "  ! RAM quase cheia: feche programas pesados / reduza abas do navegador." Red }
    $mm = Get-MMAgent
    Say "Compressao de memoria: $(if ($mm.MemoryCompression) {'ligada (ok)'} else {'DESLIGADA (a opcao 2 liga)'})"
    $pf = Get-CimInstance Win32_ComputerSystem
    Say "Pagefile gerenciado pelo Windows: $(if ($pf.AutomaticManagedPagefile) {'sim (ideal)'} else {'NAO - recomendado deixar automatico'})"
    Say "Top 8 processos por RAM:"
    Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 |
        ForEach-Object { "   {0,-28} {1,7:N0} MB" -f $_.ProcessName, ($_.WorkingSet64/1MB) } | Write-Host
    Say "Top 5 processos por CPU (acumulado):"
    Get-Process | Where-Object CPU | Sort-Object CPU -Descending | Select-Object -First 5 |
        ForEach-Object { "   {0,-28} {1,9:N0} s CPU" -f $_.ProcessName, $_.CPU } | Write-Host

    Say "`n-- Programas na inicializacao --" Yellow
    $n = (Get-StartupEntries).Count
    Say "$n entradas (opcao 4 permite desativar as que nao precisa, de forma reversivel)"
    Say "`nDica fisica: limpar saidas de ar/ventoinhas, base cooler e trocar pasta termica (a cada 1-2 anos) costumam reduzir 10-20 C." Cyan
}

# ---------------------------------------------------------------- 2) memoria (seguro)
function Optimize-Memory {
    Say "`n=== MEMORIA ===" Cyan
    $bk = Load-Backup; if (-not $bk) { $bk = [pscustomobject]@{} }
    $mm = Get-MMAgent
    if (-not $mm.MemoryCompression) {
        if (-not ($bk.PSObject.Properties.Name -contains 'MemoryCompressionWasOff')) {
            $bk | Add-Member -NotePropertyName MemoryCompressionWasOff -NotePropertyValue $true -Force
        }
        Enable-MMAgent -MemoryCompression
        Save-Backup $bk; Log 'Compressao de memoria ligada'
        Say "Compressao de memoria LIGADA (vale apos reiniciar)." Green
    } else { Say "Compressao de memoria ja estava ligada." }
    Say "Nao uso 'limpadores' de RAM: forcam o Windows a descartar cache util e deixam tudo MAIS lento."
    Say "O ganho real vem de: menos programas na inicializacao (opcao 4) e menos apps pesados abertos."
}

# ---------------------------------------------------------------- 3) limpeza de temporarios (seguro)
function Clear-OldTemp {
    Say "`n=== LIMPEZA DE TEMPORARIOS (so arquivos com mais de 7 dias) ===" Cyan
    $limit = (Get-Date).AddDays(-7); $freed = 0L; $count = 0
    foreach ($dir in @($env:TEMP, "$env:SystemRoot\Temp")) {
        if (-not (Test-Path $dir)) { continue }
        Get-ChildItem -LiteralPath $dir -Recurse -Force -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $limit } | ForEach-Object {
                try { $s = $_.Length; Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $freed += $s; $count++ } catch {}
            }
    }
    Say ("{0} arquivos removidos, {1:N0} MB liberados (arquivos em uso foram ignorados)." -f $count, ($freed/1MB)) Green
    Log "Temp: $count arquivos, $([int]($freed/1MB)) MB"
}

# ---------------------------------------------------------------- 4) inicializacao (reversivel)
$Protected = 'security|defender|realtek|nvidia|intel|amd|synaptics|touchpad|acer|predator|onedrive|audio|bluetooth|windows'
function Get-StartupEntries {
    $list = @()
    $sources = @(
        @{ Hive='HKCU'; Run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; Appr='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
        @{ Hive='HKLM'; Run='HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; Appr='HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
    )
    foreach ($s in $sources) {
        if (-not (Test-Path $s.Run)) { continue }
        $props = Get-ItemProperty $s.Run
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like 'PS*') { continue }
            $enabled = $true
            if (Test-Path $s.Appr) {
                $v = (Get-ItemProperty $s.Appr -ErrorAction SilentlyContinue).($p.Name)
                if ($v -and $v[0] -band 1) { $enabled = $false }   # 03 = desativado
            }
            $list += [pscustomobject]@{ Name=$p.Name; Cmd=[string]$p.Value; Appr=$s.Appr; Enabled=$enabled
                                        Protected = ($p.Name + $p.Value) -match $Protected }
        }
    }
    return $list
}
function Set-StartupState($entry, [bool]$enable) {
    if (-not (Test-Path $entry.Appr)) { New-Item -Path $entry.Appr -Force | Out-Null }
    $b = New-Object byte[] 12; $b[0] = $(if ($enable) { 2 } else { 3 })
    Set-ItemProperty -Path $entry.Appr -Name $entry.Name -Value $b -Type Binary
}
function Manage-Startup {
    Say "`n=== INICIALIZACAO ===" Cyan
    $all = @(Get-StartupEntries | Where-Object { $_.Enabled })
    $sel = @($all | Where-Object { -not $_.Protected })
    if ($sel.Count -eq 0) { Say "Nada seguro para desativar encontrado."; return }
    Say "Itens ativos (drivers, seguranca e Acer/NVIDIA/Intel ficam protegidos e nao aparecem):"
    for ($i=0; $i -lt $sel.Count; $i++) { "{0,3}) {1}   [{2}]" -f ($i+1), $sel[$i].Name, ($sel[$i].Cmd.Substring(0,[math]::Min(70,$sel[$i].Cmd.Length))) | Write-Host }
    $in = Read-Host "Numeros para DESATIVAR separados por virgula (Enter = nenhum)"
    if (-not $in) { return }
    $bk = Load-Backup; if (-not $bk) { $bk = [pscustomobject]@{} }
    $done = @(); if ($bk.PSObject.Properties.Name -contains 'Startup') { $done = @($bk.Startup) }
    foreach ($tok in ($in -split '[,\s]+')) {
        if ($tok -notmatch '^\d+$') { continue }
        $idx = [int]$tok - 1
        if ($idx -lt 0 -or $idx -ge $sel.Count) { continue }
        $e = $sel[$idx]
        Set-StartupState $e $false
        $done += [pscustomobject]@{ Name=$e.Name; Appr=$e.Appr }
        Say "Desativado: $($e.Name)" Green; Log "Startup desativado: $($e.Name)"
    }
    $bk | Add-Member -NotePropertyName Startup -NotePropertyValue $done -Force
    Save-Backup $bk
}

# ---------------------------------------------------------------- 5) plano de energia / refrigeracao
function Apply-PowerPlan {
    Say "`n=== PLANO DE ENERGIA E REFRIGERACAO ===" Cyan
    Say "Perfis (criam um plano NOVO, o seu plano atual nao e modificado):"
    Say "  1) Equilibrado-frio  - turbo eficiente, fans antes de reduzir clock   (RECOMENDADO)"
    Say "  2) Frio              - desliga o turbo (CPU limitada a 99%): -10 a -20 C, ~15-25% menos pico"
    Say "  3) Desempenho        - turbo total, so com refrigeracao ativa"
    $c = Read-Host "Escolha 1-3 (Enter = 1)"; if (-not $c) { $c = '1' }
    if ($c -notin '1','2','3') { Say 'Opcao invalida.' Red; return }

    $bk = Load-Backup; if (-not $bk) { $bk = [pscustomobject]@{} }
    $had = $bk.PSObject.Properties.Name -contains 'PowerPlanGuid'
    if ($had) {   # reaplicar: remover o plano anterior criado por nos, sem perder o "plano original"
        try { powercfg /setactive $bk.PreviousPlanGuid | Out-Null; powercfg /delete $bk.PowerPlanGuid | Out-Null } catch {}
    } else {
        $m = [regex]::Match(((powercfg /getactivescheme) -join ' '), '[0-9a-fA-F-]{36}')
        $bk | Add-Member -NotePropertyName PreviousPlanGuid -NotePropertyValue $m.Value -Force
    }
    $out = (powercfg /duplicatescheme $BALANCED) -join ' '
    $new = [regex]::Match($out, '[0-9a-fA-F-]{36}').Value
    if (-not $new) { throw 'Nao foi possivel criar o plano de energia.' }
    powercfg /changename $new $PLAN_NAME "Criado pelo Predator Optimizer" | Out-Null

    $max = 100; $boost = 3; $cool = 1; $min = 5
    if ($c -eq '2') { $max = 99; $boost = 0 }
    if ($c -eq '3') { $boost = 1 }
    foreach ($mode in 'setacvalueindex','setdcvalueindex') {
        powercfg /$mode $new $SUB_PROC $G_COOLPOL  $cool  | Out-Null   # 1 = ativo (fan sobe antes do clock cair)
        powercfg /$mode $new $SUB_PROC $G_BOOSTMODE $boost | Out-Null
        powercfg /$mode $new $SUB_PROC $G_MAXSTATE $max   | Out-Null
        powercfg /$mode $new $SUB_PROC $G_MINSTATE $min   | Out-Null
    }
    if ($c -ne '3') {   # na bateria sempre mais conservador
        powercfg /setdcvalueindex $new $SUB_PROC $G_BOOSTMODE 0 | Out-Null
    }
    powercfg /setactive $new | Out-Null
    $bk | Add-Member -NotePropertyName PowerPlanGuid -NotePropertyValue $new -Force
    Save-Backup $bk; Log "Plano criado $new perfil $c"
    Say "Plano '$PLAN_NAME' criado e ativado. Desfazer: opcao 6." Green
}

# ---------------------------------------------------------------- aplicar tudo
function New-SafetyRestorePoint {
    Say "Criando ponto de restauracao do Windows..." Yellow
    try {
        Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
        Checkpoint-Computer -Description 'Predator Optimizer' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
        Say "Ponto de restauracao criado." Green
    } catch {
        Say "Aviso: nao foi possivel criar ponto de restauracao (o Windows limita 1 a cada 24h). Tudo aqui e reversivel pela opcao 6." DarkYellow
    }
}
function Apply-All {
    New-SafetyRestorePoint
    Optimize-Memory; Clear-OldTemp; Apply-PowerPlan
    Say "`nPronto. Para o startup use a opcao 4. Reinicie o PC para completar." Green
}

# ---------------------------------------------------------------- 6) desfazer
function Undo-All {
    Say "`n=== DESFAZER ===" Cyan
    $bk = Load-Backup
    if (-not $bk) { Say "Nada a desfazer (sem backup)."; return }
    if ($bk.PSObject.Properties.Name -contains 'PowerPlanGuid') {
        try {
            if ($bk.PreviousPlanGuid) { powercfg /setactive $bk.PreviousPlanGuid | Out-Null }
            powercfg /delete $bk.PowerPlanGuid | Out-Null
            Say "Plano de energia original restaurado." Green
        } catch { Say "Falha ao restaurar plano: $_" Red }
    }
    if ($bk.PSObject.Properties.Name -contains 'Startup') {
        foreach ($e in $bk.Startup) {
            try { Set-StartupState $e $true; Say "Reativado na inicializacao: $($e.Name)" Green } catch {}
        }
    }
    if ($bk.PSObject.Properties.Name -contains 'MemoryCompressionWasOff') {
        Disable-MMAgent -MemoryCompression; Say "Compressao de memoria voltou ao estado original (reinicie)." Green
    }
    Remove-Item $BackupFile -Force
    Log 'Undo executado'
    Say "Tudo restaurado. (A limpeza de temporarios nao e reversivel - eram arquivos descartaveis.)"
}

# ---------------------------------------------------------------- monitor ao vivo
function Start-Monitor {
    $csv = Join-Path $Base ("monitor_{0:yyyyMMdd_HHmmss}.csv" -f (Get-Date))
    "hora,cpu_uso,cpu_freq_pct,cpu_temp,gpu_temp,gpu_uso,ram_pct" | Set-Content $csv
    Say "Monitor ao vivo (Ctrl+C para sair). Log: $csv" Cyan
    Say "Rode um jogo/render ao mesmo tempo. FREQ caindo com USO alto = throttle." Yellow
    while ($true) {
        $p = Get-CpuPerf; $t = Get-CpuTempC; $g = Get-GpuInfo; $r = Get-RamInfo
        $flag = ''
        if ($p -and $p.Util -gt 60 -and $p.FreqPct -lt 60) { $flag = '  << THROTTLE' }
        if (($t -and $t -ge 95) -or ($g -and $g.Temp -ge 87)) { $flag += '  << QUENTE' }
        $line = "{0:HH:mm:ss}  CPU {1,3}%  freq {2,3}%  temp {3,4}  | GPU {4,4} C {5,3}%  | RAM {6,3}%{7}" -f (Get-Date),
            $p.Util, $p.FreqPct, $(if($t){"$t C"}else{'n/d'}), $(if($g){$g.Temp}else{'n/d'}), $(if($g){$g.Util}else{0}), $r.UsedPct, $flag
        Write-Host $line -ForegroundColor $(if ($flag) {'Red'} else {'Gray'})
        "{0:s},{1},{2},{3},{4},{5},{6}" -f (Get-Date), $p.Util, $p.FreqPct, $t, $(if($g){$g.Temp}), $(if($g){$g.Util}), $r.UsedPct | Add-Content $csv
        Start-Sleep -Seconds 2
    }
}

# ---------------------------------------------------------------- menu
if (-not (Test-Admin)) {
    Say "Execute como Administrador (use o arquivo Iniciar.bat)." Red; Read-Host "Enter para sair"; exit 1
}
if ($Monitor) { Start-Monitor; exit }

while ($true) {
    Clear-Host
    Say "=============== PREDATOR OPTIMIZER ===============" Cyan
    Say " 1) Diagnostico completo (somente leitura)"
    Say " 2) Memoria: ligar compressao + dicas (seguro)"
    Say " 3) Limpar temporarios antigos (seguro)"
    Say " 4) Desativar programas da inicializacao (reversivel)"
    Say " 5) Plano de energia + refrigeracao (reversivel)"
    Say " 6) DESFAZER tudo"
    Say " 7) Monitor ao vivo (temperatura / throttle)"
    Say " 8) Aplicar o pacote recomendado (2 + 3 + 5, com ponto de restauracao)"
    Say " 0) Sair"
    $o = Read-Host "`nEscolha"
    try {
        switch ($o) {
            '1' { Show-Diagnostic }
            '2' { New-SafetyRestorePoint; Optimize-Memory }
            '3' { Clear-OldTemp }
            '4' { Manage-Startup }
            '5' { New-SafetyRestorePoint; Apply-PowerPlan }
            '6' { Undo-All }
            '7' { Start-Monitor }
            '8' { Apply-All }
            '0' { exit }
        }
    } catch { Say "Erro: $($_.Exception.Message)" Red; Log "ERRO: $_" }
    Read-Host "`nEnter para voltar ao menu"
}
