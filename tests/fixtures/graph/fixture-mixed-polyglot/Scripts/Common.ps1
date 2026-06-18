function Write-BuildBanner {
    param([string]$Message)
    Write-Host "== $Message =="
}

Export-ModuleMember -Function Write-BuildBanner