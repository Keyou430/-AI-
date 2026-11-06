param([string]$Directory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot '../../installer/authServerBinding.ps1')
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Fails([scriptblock]$Operation) {
    $failed = $false
    try { & $Operation } catch { $failed = $true }
    Assert-True $failed 'Expected operation to fail'
}
$cases = 0
foreach ($value in @('http://example.com', 'https://example.com/v1', 'https://user:pass@example.com', 'https://example.com/?a=1', 'https://example.com/#a', 'invalid')) {
    Assert-Fails { Get-AuthServerUrl $value }
}
Assert-True ((Get-AuthServerUrl ' https://example.com:8443/ ') -eq 'https://example.com:8443') 'URL normalization failed'
$cases++
# 用协议样本替代网络；不连接真实账号服务、不放宽生产 HTTPS 验证。
$script:ProbeIndex = 0
$script:Probes = @(@{ Status = 200; Body = @{ success = $true } }, @{ Status = 401; Body = @{ success = $false; errorCode = 'AUTH_REQUIRED' } })
function Invoke-AuthProbe([string]$Url) { return $script:Probes[($script:ProbeIndex++)] }
Test-AuthServer 'https://fixture.example.com'; $cases++
$script:ProbeIndex = 0; $script:Probes = @(@{ Status = 302; Body = @{ success = $true } })
Assert-Fails { Test-AuthServer 'https://fixture.example.com' }; $cases++
$script:ProbeIndex = 0; $script:Probes = @(@{ Status = 200; Body = @{ success = $true } }, @{ Status = 200; Body = @{ success = $true } })
Assert-Fails { Test-AuthServer 'https://fixture.example.com' }; $cases++
$script:ProbeIndex = 0; $script:Probes = @(@{ Status = 200; Body = @{ success = 'true' } })
Assert-Fails { Test-AuthServer 'https://fixture.example.com' }; $cases++
$device = Join-Path $Directory 'installer-device'
$null = [IO.Directory]::CreateDirectory($device)
$validated = Join-Path $Directory 'validated.json'
[IO.File]::WriteAllText($validated, '{"version":1,"url":"https://first.example.com"}')
Install-AuthBinding $device $validated ''
$file = Join-Path $device 'auth-server-binding.json'
Assert-True ((Read-AuthBinding $file).url -eq 'https://first.example.com') 'First binding failed'; $cases++
[IO.File]::WriteAllText($validated, '{"version":1,"url":"https://second.example.com"}')
Install-AuthBinding $device $validated ''
Assert-True ((Read-AuthBinding $file).url -eq 'https://first.example.com') 'Existing binding was overwritten'; $cases++
# 覆盖升级不探测网络；现有服务器不可达也保留原地址。
function Invoke-AuthProbe([string]$Url) { throw 'offline' }
Install-AuthBinding $device '' ''
Assert-True ((Read-AuthBinding $file).url -eq 'https://first.example.com') 'Offline upgrade lost binding'; $cases++
[IO.File]::WriteAllText($file, 'broken')
Assert-Fails { Install-AuthBinding $device $validated '' }
Assert-True ([IO.File]::ReadAllText($file) -eq 'broken') 'Invalid binding was silently replaced'; $cases++
foreach ($name in @('providers.encrypted', 'providers.encrypted.tmp', 'provider-reset-versions.json', 'provider-reset-versions.json.tmp', 'auth-server-binding.json.tmp', 'business.keep', 'video-remix-history.sqlite')) {
    [IO.File]::WriteAllText((Join-Path $device $name), 'fixture')
}
Remove-AuthBinding $device
foreach ($name in @('auth-server-binding.json', 'providers.encrypted', 'providers.encrypted.tmp', 'provider-reset-versions.json', 'provider-reset-versions.json.tmp', 'auth-server-binding.json.tmp')) {
    Assert-True (-not [IO.File]::Exists((Join-Path $device $name))) 'Uninstall left configuration behind'
}
Assert-True ([IO.File]::ReadAllText((Join-Path $device 'business.keep')) -eq 'fixture') 'Business data removed'
Assert-True ([IO.File]::ReadAllText((Join-Path $device 'video-remix-history.sqlite')) -eq 'fixture') 'Database removed'
Remove-AuthBinding (Join-Path $Directory 'missing')
$cases++
Install-AuthBinding $device $validated ''
Assert-True ((Read-AuthBinding $file).url -eq 'https://second.example.com') 'Reinstall could not bind a new server'; $cases++
Remove-AuthBinding $device
$legacy = Join-Path $Directory 'legacy.json'
[IO.File]::WriteAllText($legacy, '{"url":"https://legacy.example.com"}')
Install-AuthBinding $device '' $legacy
Assert-True ((Read-AuthBinding $file).url -eq 'https://legacy.example.com') 'Legacy upgrade lost server'
Assert-Fails { Install-AuthBinding (Join-Path $Directory 'unbound') '' '' }
$cases++
@{ success = $true; cases = $cases } | ConvertTo-Json -Compress
