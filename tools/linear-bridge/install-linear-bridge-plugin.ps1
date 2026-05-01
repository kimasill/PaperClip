# Linear bridge 플러그인: 로컬 빌드 후 Paperclip API로 설치합니다.
# 사용: 저장소 루트에서 실행하거나, 인자로 ApiBase/Cookie를 넘깁니다.
# 보드 API는 인증이 필요할 수 있습니다. 실패 시 브라우저에서 로그인한 뒤
# 개발자 도구에서 Cookie 헤더를 복사해 환경변수 PAPERCLIP_BOARD_COOKIE 로 넘기거나
# -Cookie 매개변수로 지정하세요.

param(
    [string]$ApiBase = "http://127.0.0.1:3100",
    [string]$Cookie = $env:PAPERCLIP_BOARD_COOKIE
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pluginPath = Join-Path $RepoRoot "packages\plugins\plugin-linear-bridge"

Write-Host "Building @paperclipai/plugin-linear-bridge ..."
Push-Location $RepoRoot
try {
    corepack pnpm --filter @paperclipai/plugin-linear-bridge build
}
finally {
    Pop-Location
}

$headers = @{
    "Content-Type" = "application/json; charset=utf-8"
}
if ($Cookie) {
    $headers["Cookie"] = $Cookie
}

$bodyObj = @{
    packageName = $pluginPath
    isLocalPath = $true
}
$body = $bodyObj | ConvertTo-Json -Compress

Write-Host "POST $ApiBase/api/plugins/install"
try {
    $r = Invoke-RestMethod -Uri "$ApiBase/api/plugins/install" -Method Post -Body $body -Headers $headers
    $r | ConvertTo-Json -Depth 20
    Write-Host ""
    Write-Host "설치된 플러그인 id (UUID): $($r.id)"
    Write-Host "pluginKey: $($r.pluginKey)"
}
catch {
    Write-Error $_
    Write-Host "401/403이면 보드 세션 쿠키가 필요합니다. 예: `$env:PAPERCLIP_BOARD_COOKIE='session=...'` 후 재실행."
    exit 1
}
