param([string]$Destination = 'C:\Users\User\Desktop\COUNTER V2')
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$target = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($source -eq $target) { Write-Host 'Files are already in the destination folder.'; exit 0 }
if (!(Test-Path -LiteralPath "$source\dist\COUNTER.exe")) { throw 'The executable is missing. Run build.ps1 first.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
# Duplicate the source files and the built app. Never delete anything in the destination.
$exclude = @('.git', 'bin', 'obj', 'node_modules', '.packages', 'test-results', 'COUNTER_V2.zip')
Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
}
Write-Host "Ready: $target\dist\COUNTER.exe"
