param(
    [string]$Configuration = "Debug"
)

Write-Host "Building Polyglot.App ($Configuration)"
dotnet build "..\src\Polyglot.App.csproj" -c $Configuration