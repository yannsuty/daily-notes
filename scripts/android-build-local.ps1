# Build APK release en local (Windows PowerShell)
# Prérequis : Node 24+, JDK 21, Android SDK (Android Studio)

param(
  [string]$VercelUrl = $env:VITE_API_BASE_URL,
  [string]$KeystorePath = (Join-Path $PSScriptRoot "..\release.keystore"),
  [string]$StorePassword = $env:ANDROID_KEYSTORE_PASSWORD,
  [string]$KeyAlias = $env:ANDROID_KEY_ALIAS,
  [string]$KeyPassword = $env:ANDROID_KEY_PASSWORD
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")

function Find-Java21 {
  $candidates = @(
    "C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe",
    "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
  )
  foreach ($pattern in $candidates) {
    $java = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($java) { return $java.Directory.FullName }
  }
  return $null
}

$javaBin = Find-Java21
if (-not $javaBin) {
  Write-Host "JDK 21 introuvable. Installez-le : winget install EclipseAdoptium.Temurin.21.JDK" -ForegroundColor Red
  exit 1
}
$env:JAVA_HOME = Split-Path $javaBin -Parent
$env:Path = "$javaBin;$env:Path"

if (-not $env:ANDROID_HOME) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $defaultSdk) { $env:ANDROID_HOME = $defaultSdk }
}
if (-not $env:ANDROID_HOME) {
  Write-Host "ANDROID_HOME introuvable. Installez Android Studio ou définissez ANDROID_HOME." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $KeystorePath)) {
  Write-Host "Keystore introuvable : $KeystorePath" -ForegroundColor Red
  exit 1
}

if (-not $StorePassword) {
  $secure = Read-Host "Mot de passe keystore" -AsSecureString
  $StorePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}
if (-not $KeyAlias) {
  Write-Host "`nAliases dans le keystore :" -ForegroundColor Cyan
  & "$javaBin\keytool.exe" -list -keystore $KeystorePath -storepass $StorePassword
  $KeyAlias = Read-Host "Alias a utiliser"
}
if (-not $KeyPassword) { $KeyPassword = $StorePassword }

$env:ANDROID_KEYSTORE_FILE = (Resolve-Path $KeystorePath).Path
$env:ANDROID_KEYSTORE_PASSWORD = $StorePassword
$env:ANDROID_KEY_ALIAS = $KeyAlias
$env:ANDROID_KEY_PASSWORD = $KeyPassword

Push-Location $root
try {
  if ($VercelUrl) { $env:VITE_API_BASE_URL = $VercelUrl }
  npm run build:cap
  npx cap sync android
  Push-Location android
  try {
    .\gradlew.bat assembleRelease
    $apk = "app\build\outputs\apk\release\app-release.apk"
    if (Test-Path $apk) {
      Write-Host "`nAPK genere : $(Resolve-Path $apk)" -ForegroundColor Green
    }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
