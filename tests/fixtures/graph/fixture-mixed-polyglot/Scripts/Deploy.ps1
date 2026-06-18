. "$PSScriptRoot\Build.ps1"

function Deploy-App {
    param([string]$Environment = "dev")
    Write-Host "Deploying to $Environment"
    dotnet publish "..\src\Polyglot.App.csproj" -c Release
}

Deploy-App -Environment dev