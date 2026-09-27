# Starts the SPIN-KN Fleet server. Needs only Windows PowerShell 5.1 and
# .NET Framework 4.7.2+ (both built into Windows 10/11): the C# server in
# .\server is compiled in memory at start-up.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$host.UI.RawUI.WindowTitle = 'SPIN-KN Fleet Server'

$sources = Get-ChildItem -Path (Join-Path $root 'server') -Filter '*.cs' | ForEach-Object { $_.FullName }
try {
    Add-Type -Path $sources -ReferencedAssemblies 'System.Core', 'System.Web.Extensions', 'System.Net', 'System.Net.Http'
} catch {
    Write-Host "The server code failed to compile:" -ForegroundColor Red
    Write-Host $_
    exit 1
}

try {
    [SpinFleet.Program]::Run($root)
} catch {
    Write-Host "The server could not start:" -ForegroundColor Red
    Write-Host $_.Exception.InnerException.Message
    Write-Host "If port 3000 is in use, change `"port`" in server\config.json."
    exit 1
}

# The listener runs on background threads; keep the process alive.
while ($true) { Start-Sleep -Seconds 3600 }
