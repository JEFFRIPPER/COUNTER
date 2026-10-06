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
$resources = [ordered]@{
    'index.html' = (Join-Path $PSScriptRoot 'src\index.html')
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
& $compilerPath @compilerArguments
if ($LASTEXITCODE -ne 0) { throw 'COUNTER compilation failed.' }
if ($MirrorDirectory) {
    New-Item -ItemType Directory -Path $MirrorDirectory -Force | Out-Null
    Copy-Item -LiteralPath $executablePath -Destination $MirrorDirectory -Force
}
Write-Host "Ready: $executablePath"
Write-Host ('Size: ' + [Math]::Round((Get-Item $executablePath).Length / 1KB) + ' KB; one executable, no sidecar files.')

if ($Install) { & (Join-Path $PSScriptRoot 'install.ps1') }
