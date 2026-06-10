# Сглобява подписан .aab за Google Play.
# Преди първо пускане: копирай keystore.properties.example -> keystore.properties и попълни паролата.
param(
    [switch]$UseBubblewrap
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path "android.keystore")) {
    Write-Error "Липсва android.keystore"
}

if ($UseBubblewrap) {
    bubblewrap build
    if (Test-Path "app-release-bundle.aab") {
        Write-Host "`nГотов файл: $PWD\app-release-bundle.aab"
    }
    exit 0
}

if (-not (Test-Path "keystore.properties")) {
    Write-Error "Създай keystore.properties от keystore.properties.example (парола за android.keystore)"
}

.\gradlew.bat bundleRelease
$out = "app\build\outputs\bundle\release\app-release.aab"
if (Test-Path $out) {
    Copy-Item $out "app-release-bundle.aab" -Force
    Write-Host "`nГотов файл: $PWD\app-release-bundle.aab"
} else {
    Write-Error "Build неуспешен – липсва $out"
}
