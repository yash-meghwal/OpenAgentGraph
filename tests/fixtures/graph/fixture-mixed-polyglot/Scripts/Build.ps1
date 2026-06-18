param(
    [string]$Configuration = "Debug"
)

Import-Module BuildTools -ErrorAction SilentlyContinue

function Build-App {
    Write-Host "Building Polyglot.App ($Configuration)"
    dotnet build "..\src\Polyglot.App.csproj" -c $Configuration
}

. "$PSScriptRoot\Common.ps1"
Build-App