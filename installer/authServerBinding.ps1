param(
    [ValidateSet('Validate', 'Install', 'Uninstall')][string]$Action,
    [string]$DataDirectory,
    [string]$UrlFile,
    [string]$LegacyConfig
)

$ErrorActionPreference = 'Stop'

function Get-AuthServerUrl([string]$Value) {
    $uri = $null
    if (-not [Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or -not $uri.Host -or $uri.UserInfo -or
        $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
        throw '服务器地址必须是 HTTPS 根地址，不得包含账号、密码、参数或子路径。'
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Invoke-AuthProbe([string]$Url) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    try {
        $response = $client.GetAsync($Url).GetAwaiter().GetResult()
        try {
            return @{ Status = [int]$response.StatusCode; Body = ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json) }
        } finally { $response.Dispose() }
    } finally { $client.Dispose() }
}

function Test-AuthServer([string]$Url) {
    $health = Invoke-AuthProbe ($Url + '/health')
    if ($health.Status -ne 200 -or $health.Body.success -isnot [bool] -or -not $health.Body.success) {
        throw '服务器健康检查失败。'
    }
    $auth = Invoke-AuthProbe ($Url + '/v1/me')
    if ($auth.Status -ne 401 -or $auth.Body.success -isnot [bool] -or $auth.Body.success -or $auth.Body.errorCode -cne 'AUTH_REQUIRED') {
        throw '服务器未提供预期的授权接口。'
    }
}

function Read-AuthBinding([string]$File) {
    $binding = [IO.File]::ReadAllText($File) | ConvertFrom-Json
    if ($binding.version -ne 1) { throw '绑定记录无效，请卸载后重新安装。' }
    return @{ version = 1; url = (Get-AuthServerUrl $binding.url) }
}

function Install-AuthBinding([string]$Directory, [string]$ValidatedFile, [string]$PreviousConfig) {
    $file = Join-Path $Directory 'auth-server-binding.json'
    if ([IO.File]::Exists($file)) {
        $null = Read-AuthBinding $file
        return
    }
    if ($ValidatedFile -and [IO.File]::Exists($ValidatedFile)) {
        $binding = Read-AuthBinding $ValidatedFile
    } elseif ($PreviousConfig) {
        $legacy = [IO.File]::ReadAllText($PreviousConfig) | ConvertFrom-Json
        $binding = @{ version = 1; url = (Get-AuthServerUrl $legacy.url) }
    } else { throw '首次安装必须填写并验证授权服务器地址。' }
    $null = [IO.Directory]::CreateDirectory($Directory)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($binding | ConvertTo-Json -Compress))
    $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function Remove-AuthBinding([string]$Directory) {
    if (-not [IO.Directory]::Exists($Directory)) { return }
    # 只删除绑定与 API 配置，不删除数据库、素材、知识库或其他本机资料。
    foreach ($name in @('providers.encrypted', 'provider-reset-versions.json', 'auth-server-binding.json')) {
        [IO.File]::Delete((Join-Path $Directory ($name + '.tmp')))
        [IO.File]::Delete((Join-Path $Directory $name))
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        switch ($Action) {
            'Validate' {
                # 输入通过文件传递，不将用户输入拼接为命令。
                $url = Get-AuthServerUrl ([IO.File]::ReadAllText($UrlFile))
                Test-AuthServer $url
                [IO.File]::WriteAllText($UrlFile + '.validated', (@{ version = 1; url = $url } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
            }
            'Install' { Install-AuthBinding $DataDirectory $UrlFile $LegacyConfig }
            'Uninstall' { Remove-AuthBinding $DataDirectory }
            default { throw '未指定安装操作。' }
        }
        exit 0
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
