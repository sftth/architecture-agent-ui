<#
.SYNOPSIS
  architecture-agent-ui 백엔드(uvicorn)·프론트엔드(vite)를 Windows 서비스로 등록하고
  기동 · 정지 · 재기동 · 상태 · 로그를 한 자리에서 다룬다. 서비스 래퍼는 NSSM 을 쓴다.

.DESCRIPTION
  서비스 이름은 systemd 예시(README)와 같다.
    architecture-agent-ui-backend   : backend\.venv\Scripts\python.exe -m uvicorn ... --port 9000
    architecture-agent-ui-frontend  : node.exe node_modules\vite\bin\vite.js --port 5274

  install 은 관리자 권한이 필요하다(없으면 UAC 창을 띄워 스스로 다시 실행한다).
  install 이 지금 사용자에게 두 서비스의 시작·정지 권한을 부여하므로, 그 뒤의 start/stop/restart 는
  일반 터미널에서 UAC 없이 된다.

  서비스는 기본으로 "지금 로그인한 사용자" 계정으로 뜬다. 백엔드가 자식으로 띄우는 claude CLI 가
  이 사용자의 로그인(~\.claude)·git 설정·PATH 를 그대로 써야 하기 때문이다. 그래서 install 때
  Windows 비밀번호를 한 번 묻는다(서비스 관리자에 저장되며 이 스크립트는 남기지 않는다).
  회사 정책으로 비밀번호를 바꾸면 서비스가 로그온 실패로 뜨지 않으니 install 을 다시 실행한다.

.EXAMPLE
  .\service.ps1 install            # 등록 + 기동 (비밀번호 1회 입력)
  .\service.ps1 restart            # 둘 다 재기동
  .\service.ps1 restart backend    # 백엔드만
  .\service.ps1 status             # 서비스 상태 + 헬스체크
  .\service.ps1 logs backend       # 로그 따라 보기 (Ctrl+C 로 종료)
  .\service.ps1 uninstall          # 서비스 제거 (파일·데이터는 그대로)

.EXAMPLE
  .\service.ps1 install -FrontendHost 0.0.0.0     # 다른 PC 에서 접속할 때
  .\service.ps1 install -Account LocalSystem      # 비밀번호 없이 시스템 계정으로 (claude 로그인이 달라 시험용)
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'help')]
    [string]$Action = 'help',

    # start/stop/restart/logs 대상. logs 에서 all 이면 backend 를 본다.
    [Parameter(Position = 1)]
    [ValidateSet('backend', 'frontend', 'all')]
    [string]$Target = 'all',

    # 서비스 실행 계정. 비우면 지금 사용자(DOMAIN\user). 'LocalSystem' 도 가능.
    [string]$Account = '',
    # 비밀번호를 미리 넘길 때. 없으면 install 중에 Get-Credential 로 묻는다.
    [pscredential]$Credential,

    [int]$BackendPort = 9000,
    [int]$FrontendPort = 5274,
    # 원격 PC 에서 접속하려면 0.0.0.0
    [string]$FrontendHost = '127.0.0.1',
    # 백엔드 --reload 를 빼고 싶을 때(개발 중이 아니면)
    [switch]$NoReload,
    # install 만 하고 띄우지 않는다
    [switch]$NoStart,
    # 내부용: UAC 로 다시 띄워진 프로세스 표시
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LogDir = Join-Path $Root 'logs'
$NssmDir = Join-Path $PSScriptRoot '.nssm'

$Services = [ordered]@{
    backend  = 'architecture-agent-ui-backend'
    frontend = 'architecture-agent-ui-frontend'
}

# ── 출력 도우미 ─────────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Note([string]$msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "[X] $msg" -ForegroundColor Red }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CurrentUserName { return [Security.Principal.WindowsIdentity]::GetCurrent().Name }
function Get-CurrentUserSid { return [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }

# 관리자 권한이 없으면 같은 인자로 UAC 창을 띄워 다시 실행한다. $true 를 돌려주면 호출자는 그냥 끝낸다.
function Invoke-Elevated {
    if (Test-Admin) { return $false }
    Write-Step '관리자 권한이 필요합니다. UAC 창을 띄웁니다...'
    $exe = (Get-Process -Id $PID).Path
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), $Action, $Target, '-Elevated')
    foreach ($k in $PSBoundParameters.Keys) {
        if ($k -in @('Action', 'Target', 'Credential', 'Elevated')) { continue }
        $v = $PSBoundParameters[$k]
        if ($v -is [switch]) { if ($v) { $argList += "-$k" } }
        else { $argList += "-$k"; $argList += ('"{0}"' -f $v) }
    }
    Start-Process -FilePath $exe -Verb RunAs -ArgumentList $argList -Wait
    return $true
}

# ── NSSM ────────────────────────────────────────────────────────────────────
function Get-Nssm {
    $local = Join-Path $NssmDir 'nssm.exe'
    if (Test-Path $local) { return $local }
    $onPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($onPath) {
        $prev = [Console]::OutputEncoding
        try { [Console]::OutputEncoding = [Text.Encoding]::Unicode; $banner = (& $onPath.Source 2>&1 | Out-String) }
        finally { [Console]::OutputEncoding = $prev }
        if ($banner -match '2\.24-\d') { Write-Note "PATH 의 nssm($($onPath.Source))은 CI 빌드입니다. Windows 11 에서 정지가 멈추는 문제가 있어 정식 2.24 를 내려받아 씁니다." }
        else { return $onPath.Source }
    }

    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
    $zip = Join-Path $NssmDir 'nssm.zip'
    $tmp = Join-Path $NssmDir 'unzip'
    # 정식 2.24 를 쓴다. CI 빌드 2.24-101 은 Windows 11 에서 RegisterWaitForSingleObject() 가
    # "매개 변수가 틀립니다" 로 실패해(이벤트 1009) 자식 종료를 감지하지 못하고, 정지하면
    # STOP_PENDING 에 영원히 머문다 — 이 저장소에서 실제로 겪은 일이다.
    $urls = @('https://nssm.cc/release/nssm-2.24.zip')
    foreach ($u in $urls) {
        try {
            Write-Step "NSSM 내려받기: $u"
            Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
            if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
            $exe = Get-ChildItem -Path $tmp -Recurse -Filter nssm.exe |
                Where-Object { $_.FullName -match '\\win64\\' } | Select-Object -First 1
            if (-not $exe) { throw 'zip 안에 win64\nssm.exe 가 없습니다' }
            Copy-Item $exe.FullName $local -Force
            Remove-Item -Recurse -Force $tmp, $zip -ErrorAction SilentlyContinue
            Write-Ok "NSSM 준비: $local"
            return $local
        } catch {
            Write-Note "받지 못했습니다: $($_.Exception.Message)"
        }
    }
    throw "NSSM 을 받을 수 없습니다. https://nssm.cc/release/nssm-2.24.zip 을 받아 win64\nssm.exe 를 '$local' 에 두고 다시 실행하세요."
}

# nssm.exe 는 UTF-16 으로 찍으므로 콘솔 인코딩을 잠시 바꿔 부른다. 인자는 배열 하나로 넘긴다.
function Invoke-Nssm([string]$Nssm, [string[]]$NssmArgs) {
    $prev = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [Text.Encoding]::Unicode
        $out = & $Nssm @NssmArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $prev
    }
    if ($code -ne 0) {
        $shown = $NssmArgs
        if ($NssmArgs.Length -ge 2 -and $NssmArgs[0] -eq 'set' -and $NssmArgs[2] -eq 'ObjectName') { $shown = $NssmArgs[0..2] + '***' }
        throw "nssm $($shown -join ' ') 실패 (exit $code): $($out -join ' ')"
    }
    return $out
}

# ── 서비스 조회 ─────────────────────────────────────────────────────────────
function Get-Svc([string]$name) { return Get-Service -Name $name -ErrorAction SilentlyContinue }

function Get-TargetKeys {
    if ($Target -eq 'all') { return @($Services.Keys) }
    return @($Target)
}

function Get-LogPath([string]$key) { return Join-Path $LogDir "$key.log" }

function Test-PortFree([int]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return (-not $c)
}

# 정지 요청을 보내고 정해진 시간만 기다린다. Stop-Service 는 STOP_PENDING 에 걸리면 끝없이
# 기다리므로 쓰지 않는다. 시간 안에 안 내려오면 서비스 프로세스(nssm)를 직접 끊는다 —
# nssm 이 죽으면 SCM 이 서비스를 Stopped 로 본다.
function Stop-SvcBounded([string]$name, [int]$seconds = 40) {
    $svc = Get-Svc $name
    if (-not $svc -or $svc.Status -eq 'Stopped') { return }
    $wmi = Get-CimInstance Win32_Service -Filter ("Name = '{0}'" -f $name) -ErrorAction SilentlyContinue
    $svcPid = if ($wmi) { $wmi.ProcessId } else { 0 }
    if ($svc.Status -ne 'StopPending') {
        try { Stop-Service -Name $name -Force -NoWait -ErrorAction Stop } catch { throw }
    }
    try {
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds($seconds))
    } catch {
        Write-Note "$name 이(가) ${seconds}초 안에 내려오지 않아 서비스 프로세스(PID $svcPid)를 강제로 끊습니다"
        if ($svcPid) { Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue }
        try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(10)) } catch { throw "$name 을(를) 정지하지 못했습니다(상태: $((Get-Svc $name).Status))" }
    }
}

# 서비스를 세우고 제거한 뒤, SCM 에서 완전히 사라질 때까지 기다린다(바로 다시 install 하려면 필요).
function Remove-Svc([string]$nssm, [string]$name) {
    $svc = Get-Svc $name
    if (-not $svc) { return }
    Stop-SvcBounded $name
    Invoke-Nssm $nssm @('remove', $name, 'confirm') | Out-Null
    for ($i = 0; $i -lt 20 -and (Get-Svc $name); $i++) { Start-Sleep -Milliseconds 500 }
    if (Get-Svc $name) { throw "$name 이(가) 아직 제거되지 않았습니다(삭제 대기 중). 서비스 창·이벤트 뷰어를 닫고 다시 실행하세요." }
}

# 지금 사용자에게 서비스 시작·정지 권한을 준다. 이후 start/stop 은 UAC 없이 된다.
function Grant-ServiceControl([string]$name, [string]$sid) {
    $lines = & sc.exe sdshow $name
    $sd = ($lines | Where-Object { $_ -match '^D:' } | Select-Object -First 1)
    if (-not $sd) { Write-Note "$name 의 보안 설명자를 읽지 못해 권한 부여를 건너뜁니다"; return }
    $sd = $sd.Trim()
    if ($sd -like "*;;;$sid)*") { return }
    # CC LC SW RP WP DT LO CR RC = 조회 · 시작 · 정지 · 일시중지 · 상태 확인
    $ace = "(A;;CCLCSWRPWPDTLOCRRC;;;$sid)"
    $idx = $sd.IndexOf('S:')
    if ($idx -ge 0) { $new = $sd.Insert($idx, $ace) } else { $new = $sd + $ace }
    & sc.exe sdset $name $new | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Note "$name 시작·정지 권한 부여 실패 (sc sdset exit $LASTEXITCODE)" }
}

# ── 서비스 계정 검증 ────────────────────────────────────────────────────────
# 비밀번호를 서비스에 저장하기 전에 SCM 이 하는 것과 같은 방식(LOGON32_LOGON_SERVICE)으로
# 실제 로그온을 시험한다. 틀린 비밀번호를 저장하면 서비스가 1069 로만 죽어 원인이 보이지 않는다.
$LogonTypeSource = @'
using System;
using System.Runtime.InteropServices;
public static class AaUiLogon {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LogonUser(string user, string domain, string password, int logonType, int logonProvider, out IntPtr token);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@

function Test-ServiceLogon([pscredential]$cred) {
    if (-not ('AaUiLogon' -as [type])) { Add-Type -TypeDefinition $LogonTypeSource }
    $user = $cred.UserName; $domain = '.'
    if ($user -match '^(.+)\\(.+)$') { $domain = $Matches[1]; $user = $Matches[2] }
    elseif ($user -match '@') { $domain = $null }
    $pw = $cred.GetNetworkCredential().Password
    $result = @{ ok = $false; code = 0 }
    foreach ($type in 5, 3) {   # 5 = SERVICE, 3 = NETWORK (서비스 로그온 권한이 아직 없을 때의 대안)
        $tok = [IntPtr]::Zero
        $ok = [AaUiLogon]::LogonUser($user, $domain, $pw, $type, 0, [ref]$tok)
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($tok -ne [IntPtr]::Zero) { [AaUiLogon]::CloseHandle($tok) | Out-Null }
        if ($ok) { return @{ ok = $true; code = 0 } }
        $result.code = $err
        if ($err -ne 1385) { break }   # 1385 = 이 로그온 유형 권한 없음 → NETWORK 로 한 번 더
    }
    return $result
}

function Describe-LogonError([int]$code) {
    switch ($code) {
        1326 { '사용자 이름 또는 비밀번호가 틀립니다' }
        1311 { '도메인 컨트롤러에 연결할 수 없습니다(VPN · 사내망 연결 확인)' }
        1330 { '비밀번호가 만료되었습니다' }
        1907 { '비밀번호를 바꿔야 하는 계정입니다' }
        1909 { '계정이 잠겨 있습니다' }
        1331 { '계정이 사용 중지되어 있습니다' }
        1385 { '이 계정에 서비스로 로그온 권한이 없습니다' }
        default { "Win32 오류 $code" }
    }
}

# 계정을 정하고 비밀번호를 검증한다. 세 번까지 다시 묻는다.
function Resolve-ServiceCredential {
    if ($Credential) {
        $r = Test-ServiceLogon $Credential
        if (-not $r.ok) { throw "넘겨준 자격 증명으로 로그온할 수 없습니다: $(Describe-LogonError $r.code)" }
        return $Credential
    }
    $who = if ($Account) { $Account } else { Get-CurrentUserName }
    Write-Host ''
    Write-Host "서비스를 '$who' 계정으로 띄웁니다. claude 로그인(~\.claude)·git 설정을 그대로 쓰기 위해서입니다." -ForegroundColor Gray
    Write-Host 'Windows 로그인 비밀번호를 입력하세요(서비스 관리자에 저장되며, 비밀번호를 바꾸면 install 을 다시 실행해야 합니다).' -ForegroundColor Gray
    for ($i = 1; $i -le 3; $i++) {
        $cred = Get-Credential -UserName $who -Message 'architecture-agent-ui 서비스 실행 계정'
        if (-not $cred) { throw '비밀번호를 입력하지 않아 중단합니다. 비밀번호 없이 시험하려면 -Account LocalSystem 을 쓰세요.' }
        $r = Test-ServiceLogon $cred
        if ($r.ok) { Write-Ok "계정 확인: $($cred.UserName)"; return $cred }
        Write-Fail "로그온 실패: $(Describe-LogonError $r.code) (시도 $i/3)"
    }
    throw '비밀번호를 세 번 확인하지 못해 중단합니다.'
}

# 계정과 비밀번호를 서비스에 저장한다. nssm 으로 계정을 지정해 "서비스로 로그온" 권한을 받고,
# 비밀번호는 명령행 인자를 거치지 않는 WMI 로 다시 써서 특수문자가 깨질 여지를 없앤다.
function Set-ServiceAccount([string]$nssm, [string]$name, [string]$userName, [string]$password) {
    try {
        Invoke-Nssm $nssm @('set', $name, 'ObjectName', $userName, $password) | Out-Null
    } catch {
        Write-Note "nssm 으로 계정을 지정하지 못했습니다($($_.Exception.Message)). WMI 로 계속합니다."
    }
    $wmi = Get-CimInstance Win32_Service -Filter ("Name = '{0}'" -f $name)
    $r = Invoke-CimMethod -InputObject $wmi -MethodName Change -Arguments @{ StartName = $userName; StartPassword = $password }
    if ($r.ReturnValue -ne 0) { throw "$name 계정 설정 실패 (Win32_Service.Change 반환 $($r.ReturnValue))" }
}

# ── install ─────────────────────────────────────────────────────────────────
function Install-All {
    if (Invoke-Elevated) { return }

    Write-Step "설치 경로: $Root"

    # 실행 파일들
    $python = Join-Path $Root 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) {
        Write-Step 'backend\.venv 가 없어 uv sync 를 실행합니다'
        Push-Location (Join-Path $Root 'backend')
        try { & uv sync; if ($LASTEXITCODE -ne 0) { throw 'uv sync 실패' } } finally { Pop-Location }
    }
    $viteJs = Join-Path $Root 'frontend\node_modules\vite\bin\vite.js'
    if (-not (Test-Path $viteJs)) {
        Write-Step 'frontend\node_modules 가 없어 npm install 을 실행합니다'
        Push-Location (Join-Path $Root 'frontend')
        try { & npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install 실패' } } finally { Pop-Location }
    }
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { throw 'node.exe 를 PATH 에서 찾을 수 없습니다. Node.js 18+ 를 설치하세요.' }
    $node = $nodeCmd.Source

    $claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($claudeCmd) {
        $claudeBin = $claudeCmd.Source
        Write-Ok "claude CLI: $claudeBin"
    } else {
        $claudeBin = 'claude'
        Write-Note 'claude CLI 를 PATH 에서 찾지 못했습니다. 실행 시 CLAUDE_BIN 오류가 나면 설치 후 install 을 다시 실행하세요.'
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $nssm = Get-Nssm

    # 계정
    $useLocalSystem = ($Account -eq 'LocalSystem')
    $userName = $null; $password = $null
    if (-not $useLocalSystem) {
        $cred = Resolve-ServiceCredential
        $userName = $cred.UserName
        if ($userName -notmatch '[\\@]') { $userName = ".\$userName" }
        $password = $cred.GetNetworkCredential().Password
    }

    # 정의
    $reload = if ($NoReload) { '' } else { ' --reload' }
    $defs = @(
        @{
            key     = 'backend'
            name    = $Services.backend
            display = 'architecture-agent-ui backend (FastAPI/uvicorn)'
            desc    = "architecture-agent-ui 백엔드. http://127.0.0.1:$BackendPort  ($Root)"
            app     = $python
            args    = "-m uvicorn app.main:app --host 127.0.0.1 --port $BackendPort$reload --timeout-graceful-shutdown 5"
            dir     = (Join-Path $Root 'backend')
            env     = @("CLAUDE_BIN=$claudeBin", 'PYTHONUTF8=1', 'PYTHONUNBUFFERED=1')
        },
        @{
            key     = 'frontend'
            name    = $Services.frontend
            display = 'architecture-agent-ui frontend (vite dev server)'
            desc    = "architecture-agent-ui 프론트엔드. http://${FrontendHost}:$FrontendPort  ($Root)"
            app     = $node
            args    = "node_modules\vite\bin\vite.js --host $FrontendHost --port $FrontendPort"
            dir     = (Join-Path $Root 'frontend')
            env     = @('NO_COLOR=1', 'CI=1')
        }
    )

    $sid = Get-CurrentUserSid
    foreach ($d in $defs) {
        $name = $d.name
        if (Get-Svc $name) {
            Write-Step "$name 이(가) 이미 있어 정지 후 다시 등록합니다"
            Remove-Svc $nssm $name
        }
        Write-Step "$name 등록"
        Invoke-Nssm $nssm @('install', $name, $d.app) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppParameters', $d.args) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppDirectory', $d.dir) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'DisplayName', $d.display) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'Description', $d.desc) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'Start', 'SERVICE_AUTO_START') | Out-Null
        Invoke-Nssm $nssm (@('set', $name, 'AppEnvironmentExtra') + $d.env) | Out-Null
        # 로그: 한 파일에 stdout·stderr 를 같이, 10MB 넘으면 돌린다
        $log = Get-LogPath $d.key
        Invoke-Nssm $nssm @('set', $name, 'AppStdout', $log) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppStderr', $log) | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppStdoutCreationDisposition', '4') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppStderrCreationDisposition', '4') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppRotateFiles', '1') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppRotateOnline', '1') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppRotateBytes', '10485760') | Out-Null
        # 정지: Ctrl+C 5초 → 종료 요청 → 강제. NSSM 2.24 는 자식(claude · uvicorn 워커)까지
        # 프로세스 트리로 함께 내린다(끄는 옵션 AppKillProcessTree 는 뒤 빌드에만 있다).
        Invoke-Nssm $nssm @('set', $name, 'AppStopMethodConsole', '5000') | Out-Null
        # 죽으면 3초 뒤 다시 올린다. 5초 안에 또 죽으면 잠시 기다린다.
        Invoke-Nssm $nssm @('set', $name, 'AppExit', 'Default', 'Restart') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppRestartDelay', '3000') | Out-Null
        Invoke-Nssm $nssm @('set', $name, 'AppThrottle', '5000') | Out-Null
        if ($useLocalSystem) {
            Invoke-Nssm $nssm @('set', $name, 'ObjectName', 'LocalSystem') | Out-Null
        } else {
            Set-ServiceAccount $nssm $name $userName $password
        }
        Grant-ServiceControl $name $sid
        Write-Ok "$name 등록 완료 (로그: $log)"
    }

    # 포트 점검 — 터미널에서 띄워 둔 서버가 있으면 서비스가 뜨지 못한다.
    $busy = @()
    if (-not (Test-PortFree $BackendPort)) { $busy += $BackendPort }
    if (-not (Test-PortFree $FrontendPort)) { $busy += $FrontendPort }
    if ($busy.Count -gt 0) {
        Write-Note ("포트 {0} 이(가) 이미 사용 중입니다. VS Code 터미널 등에서 띄워 둔 서버를 먼저 끄고 'service.cmd start' 를 실행하세요." -f ($busy -join ', '))
        Write-Note '서비스는 자동 시작으로 등록됐으니 다음 부팅부터는 저절로 뜹니다.'
        return
    }
    if ($NoStart) { Write-Ok "등록만 했습니다. 띄우려면 'service.cmd start'"; return }
    Start-All
}

# ── uninstall ───────────────────────────────────────────────────────────────
function Uninstall-All {
    if (Invoke-Elevated) { return }
    $nssm = Get-Nssm
    foreach ($key in $Services.Keys) {
        $name = $Services[$key]
        if (-not (Get-Svc $name)) { Write-Note "$name 은(는) 등록되어 있지 않습니다"; continue }
        Write-Step "$name 정지 · 제거"
        Remove-Svc $nssm $name
        Write-Ok "$name 제거"
    }
    Write-Host "코드 · backend\data · backend\runs · logs 는 그대로 두었습니다." -ForegroundColor Gray
}

# ── start / stop / restart ──────────────────────────────────────────────────
function Start-One([string]$key) {
    $name = $Services[$key]
    $svc = Get-Svc $name
    if (-not $svc) { throw "$name 이(가) 등록되어 있지 않습니다. 먼저 'service.cmd install'" }
    if ($svc.Status -eq 'Running') { Write-Ok "$name 이미 실행 중"; return }
    Write-Step "$name 시작"
    # Start-Service 는 실패 원인을 숨긴다("Cannot start service"). WMI 는 이유 코드를 준다.
    $wmi = Get-CimInstance Win32_Service -Filter ("Name = '{0}'" -f $name)
    $r = Invoke-CimMethod -InputObject $wmi -MethodName StartService
    $code = $r.ReturnValue
    if ($code -notin 0, 10) {
        $why = switch ($code) {
            2 { '액세스 거부. 관리자 터미널에서 실행하거나 install 을 다시 하세요(시작·정지 권한 부여).' }
            14 { '서비스가 사용 안 함으로 되어 있습니다(services.msc 에서 시작 유형 확인).' }
            15 { "서비스 계정($($wmi.StartName)) 로그온 실패. Windows 비밀번호가 틀렸거나 바뀌었습니다 — 'service.cmd install' 을 다시 실행해 비밀번호를 다시 넣으세요." }
            default { "Win32_Service.StartService 반환 코드 $code" }
        }
        Write-Fail "$name 시작 실패: $why"
        Write-Note "이벤트 뷰어 > Windows 로그 > 시스템(원본 Service Control Manager) · 응용 프로그램(원본 nssm)"
        throw "$name 시작 실패"
    }
    try {
        $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
        Write-Ok "$name 실행 중"
    } catch {
        Write-Fail "$name 이(가) 20초 안에 Running 이 되지 않았습니다(상태: $((Get-Svc $name).Status))"
        Write-Note "로그: $(Get-LogPath $key)  /  이벤트 뷰어 > 응용 프로그램(원본 nssm)"
        throw "$name 시작 실패"
    }
}

function Stop-One([string]$key) {
    $name = $Services[$key]
    $svc = Get-Svc $name
    if (-not $svc) { Write-Note "$name 은(는) 등록되어 있지 않습니다"; return }
    if ($svc.Status -eq 'Stopped') { Write-Ok "$name 이미 정지"; return }
    Write-Step "$name 정지"
    Stop-SvcBounded $name
    Write-Ok "$name 정지"
}

# 권한이 없어 실패하면 UAC 로 다시 시도한다(install 이 권한을 줬으면 여기 오지 않는다).
function Invoke-Control([scriptblock]$body) {
    try {
        & $body
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m += ' ' + $_.Exception.InnerException.Message }
        if (-not (Test-Admin) -and ($m -match 'Cannot open|액세스|denied|거부')) {
            if (Invoke-Elevated) { return }
        }
        throw
    }
}

function Start-All {
    Invoke-Control { foreach ($k in Get-TargetKeys) { Start-One $k }; Show-Health }
}
function Stop-All {
    Invoke-Control { foreach ($k in (Get-TargetKeys | Sort-Object -Descending)) { Stop-One $k } }
}
function Restart-All {
    Invoke-Control {
        foreach ($k in (Get-TargetKeys | Sort-Object -Descending)) { Stop-One $k }
        foreach ($k in Get-TargetKeys) { Start-One $k }
        Show-Health
    }
}

# ── status / logs ───────────────────────────────────────────────────────────
function Show-Health {
    $checks = @(
        @{ key = 'backend'; url = "http://127.0.0.1:$BackendPort/api/health" },
        @{ key = 'frontend'; url = "http://127.0.0.1:$FrontendPort/" }
    )
    foreach ($c in $checks) {
        if ($Target -ne 'all' -and $Target -ne $c.key) { continue }
        $ok = $false
        for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
            try {
                $r = Invoke-WebRequest -Uri $c.url -UseBasicParsing -TimeoutSec 3
                $body = if ($c.key -eq 'backend') { ' ' + $r.Content.Trim() } else { '' }
                Write-Ok ("{0,-9} {1} -> {2}{3}" -f $c.key, $c.url, $r.StatusCode, $body)
                $ok = $true
            } catch { Start-Sleep -Seconds 1 }
        }
        if (-not $ok) { Write-Fail ("{0,-9} {1} -> 응답 없음 (로그: {2})" -f $c.key, $c.url, (Get-LogPath $c.key)) }
    }
}

function Show-Status {
    $rows = foreach ($key in $Services.Keys) {
        $name = $Services[$key]
        $svc = Get-Svc $name
        $wmi = Get-CimInstance Win32_Service -Filter ("Name = '{0}'" -f $name) -ErrorAction SilentlyContinue
        [pscustomobject]@{
            Service   = $name
            Status    = if ($svc) { [string]$svc.Status } else { '(미등록)' }
            StartType = if ($svc) { [string]$svc.StartType } else { '' }
            Account   = if ($wmi) { $wmi.StartName } else { '' }
            PID       = if ($wmi -and $wmi.ProcessId) { $wmi.ProcessId } else { '' }
        }
    }
    $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
    if ($rows | Where-Object { $_.Status -eq 'Running' }) { Show-Health }
    Write-Host "로그: $(Get-LogPath 'backend'), $(Get-LogPath 'frontend')" -ForegroundColor Gray
}

function Show-Logs {
    $key = if ($Target -eq 'all') { 'backend' } else { $Target }
    $log = Get-LogPath $key
    if (-not (Test-Path $log)) { throw "로그 파일이 없습니다: $log" }
    Write-Host "$log  (Ctrl+C 로 종료)" -ForegroundColor Gray
    Get-Content -Path $log -Tail 60 -Wait -Encoding UTF8
}

function Show-Help {
    Write-Host @"
architecture-agent-ui Windows 서비스 관리

  service.cmd install [-FrontendHost 0.0.0.0] [-NoReload] [-NoStart] [-Account LocalSystem]
  service.cmd uninstall
  service.cmd start|stop|restart [backend|frontend]
  service.cmd status
  service.cmd logs [backend|frontend]

서비스 이름 : $($Services.backend), $($Services.frontend)
설치 경로   : $Root
로그        : $LogDir
"@
}

# ── 진입 ────────────────────────────────────────────────────────────────────
$exitCode = 0
try {
    switch ($Action) {
        'install'   { Install-All }
        'uninstall' { Uninstall-All }
        'start'     { Start-All }
        'stop'      { Stop-All }
        'restart'   { Restart-All }
        'status'    { Show-Status }
        'logs'      { Show-Logs }
        default     { Show-Help }
    }
} catch {
    Write-Fail $_.Exception.Message
    $exitCode = 1
} finally {
    if ($Elevated) { Read-Host 'Enter 를 누르면 창이 닫힙니다' | Out-Null }
}
exit $exitCode
