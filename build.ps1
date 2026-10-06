param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'),
    [string]$MirrorDirectory = '',
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$sdkVersion = '1.0.4258.31'
$expectedHash = '56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9'
$workDirectory = Join-Path $env:LOCALAPPDATA "COUNTER\Build\$sdkVersion"
$packagePath = Join-Path $workDirectory 'webview2.nupkg'
$packageDirectory = Join-Path $workDirectory 'sdk'
$resourceDirectory = Join-Path $workDirectory 'resources'
New-Item -ItemType Directory -Path $workDirectory,$resourceDirectory,$OutputDirectory -Force | Out-Null
if (!(Test-Path $packagePath)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $packagePath
}
if ((Get-FileHash $packagePath -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'WebView2 package checksum failed. Remove the cached package and run the build again.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (!(Test-Path (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    [IO.Compression.ZipFile]::ExtractToDirectory($packagePath,$packageDirectory)
}
# Версия берётся из package.json; по ней работает автообновление.
$version = [Version](Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'package.json') | ConvertFrom-Json).version
$utf8 = New-Object Text.UTF8Encoding($false)
$versionSource = Join-Path $resourceDirectory 'Version.cs'
[IO.File]::WriteAllText($versionSource, ("[assembly: System.Reflection.AssemblyVersion(`"{0}.0`")]`r`n[assembly: System.Reflection.AssemblyFileVersion(`"{0}.0`")]`r`n" -f $version), $utf8)
# Интерфейс хранится в нескольких файлах и склеивается в один index.html, как в tools/bundle.cjs.
$html = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'src\index.html'), $utf8)
foreach ($part in 'styles.css','core.js','app.js') {
    # Маркер занимает всю строку; checkout на Windows может дать CRLF.
    $start = $html.IndexOf("@@$part@@")
    if ($start -lt 0) { throw "Marker missing in src\index.html: $part" }
    $end = $html.IndexOf("`n", $start) + 1
    $html = $html.Substring(0, $start) + [IO.File]::ReadAllText((Join-Path $PSScriptRoot "src\$part"), $utf8) + $html.Substring($end)
}
$html = $html.Replace('__COUNTER_VERSION__', ('{0}.{1}' -f $version.Major, $version.Minor))
$bundledHtml = Join-Path $resourceDirectory 'index.html'
[IO.File]::WriteAllText($bundledHtml, $html, $utf8)
$resources = [ordered]@{
    'index.html' = $bundledHtml
    'Microsoft.Web.WebView2.Core.dll' = (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.Core.dll')
    'Microsoft.Web.WebView2.WinForms.dll' = (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.WinForms.dll')
    'x64.WebView2Loader.dll' = (Join-Path $packageDirectory 'runtimes\win-x64\native\WebView2Loader.dll')
    'x86.WebView2Loader.dll' = (Join-Path $packageDirectory 'runtimes\win-x86\native\WebView2Loader.dll')
}
$compilerArguments = @('/nologo','/target:winexe','/platform:anycpu','/langversion:5','/codepage:65001','/optimize+',
    '/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll',
    ('/reference:' + (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.Core.dll')),
    ('/reference:' + (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.WinForms.dll')),
    ('/win32manifest:' + (Join-Path $PSScriptRoot 'src\app.manifest')),
    ('/win32icon:' + (Join-Path $PSScriptRoot 'src\counter.ico')))
foreach ($entry in $resources.GetEnumerator()) {
    $destination = Join-Path $resourceDirectory ($entry.Key + '.gz')
    $inputStream = [IO.File]::OpenRead($entry.Value)
    $outputStream = [IO.File]::Create($destination)
    $compressor = New-Object IO.Compression.GZipStream($outputStream,[IO.Compression.CompressionMode]::Compress)
    try { $inputStream.CopyTo($compressor) }
    finally { $inputStream.Dispose(); $compressor.Dispose(); $outputStream.Dispose() }
    $compilerArguments += ('/resource:' + $destination + ',Counter.' + $entry.Key + '.gz')
}
$frameworkDirectory = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
$compilerPath = Join-Path $env:WINDIR "Microsoft.NET\$frameworkDirectory\v4.0.30319\csc.exe"
if (!(Test-Path $compilerPath)) { throw '.NET Framework 4.8 is required to build COUNTER.' }
$executablePath = Join-Path $OutputDirectory 'COUNTER.exe'
$compilerArguments += ('/out:' + $executablePath)
$compilerArguments += (Join-Path $PSScriptRoot 'src\Counter.cs')
$compilerArguments += (Join-Path $PSScriptRoot 'src\Updater.cs')
$compilerArguments += $versionSource
& $compilerPath @compilerArguments
if ($LASTEXITCODE -ne 0) { throw 'COUNTER compilation failed.' }
$hash = (Get-FileHash $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$executablePath.sha256", "$hash  COUNTER.exe`n", $utf8)
if ($MirrorDirectory) {
    New-Item -ItemType Directory -Path $MirrorDirectory -Force | Out-Null
    Copy-Item -LiteralPath $executablePath -Destination $MirrorDirectory -Force
}
Write-Host "Ready: $executablePath (version $version)"
Write-Host ('Size: ' + [Math]::Round((Get-Item $executablePath).Length / 1KB) + ' KB; one executable, no sidecar files.')

if ($Install) { & (Join-Path $PSScriptRoot 'install.ps1') }
