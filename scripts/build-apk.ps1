param([string]$ApiUrl, [switch]$OfflinePreview, [switch]$DeviceTest, [switch]$TestPackage)
# Local Windows APK build. Connected builds require the deployed HTTPS API.
$ErrorActionPreference = 'Stop'
if ($DeviceTest) {
    if ($ApiUrl -ne 'http://127.0.0.1:3002') { throw 'DeviceTest uses only http://127.0.0.1:3002 through adb reverse.' }
} elseif (-not $OfflinePreview) {
    $parkingApiUri = $null
    if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$parkingApiUri) -or $parkingApiUri.Scheme -ne 'https' -or $parkingApiUri.IsLoopback) {
        throw 'Pass -ApiUrl with the deployed HTTPS API address, or explicitly use -OfflinePreview.'
    }
}
$parkingProjectRoot = Split-Path -Parent $PSScriptRoot
# Use a short real path: Node canonicalizes drive aliases and breaks autolinking.
$parkingBuildParent = Join-Path ([IO.Path]::GetPathRoot($parkingProjectRoot)) 'pb'
$parkingBuildRoot = Join-Path $parkingBuildParent ([Guid]::NewGuid().ToString('N').Substring(0,8))
if (Test-Path -LiteralPath $parkingBuildRoot) { throw 'Build directory already exists.' }
New-Item -ItemType Directory -Path $parkingBuildRoot -Force | Out-Null
Push-Location $parkingProjectRoot
try {
    $parkingFiles = & git ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) { throw 'Could not inventory project source.' }
    foreach ($parkingFile in $parkingFiles) {
        if ($parkingFile -match '(^|/)\.env($|\.)' -and $parkingFile -ne '.env.example') { continue }
        $parkingSource = [IO.Path]::GetFullPath((Join-Path $parkingProjectRoot $parkingFile))
        $parkingDestination = [IO.Path]::GetFullPath((Join-Path $parkingBuildRoot $parkingFile))
        if (-not $parkingSource.StartsWith($parkingProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not $parkingDestination.StartsWith($parkingBuildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Source inventory contained a path outside the project.'
        }
        if (Test-Path -LiteralPath $parkingSource -PathType Leaf) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $parkingDestination) -Force | Out-Null
            Copy-Item -LiteralPath $parkingSource -Destination $parkingDestination
        }
    }
} finally { Pop-Location }
$parkingSavedEnvironment = @{}
foreach ($name in @('ANDROID_HOME','ANDROID_SDK_ROOT','EXPO_PUBLIC_API_URL','EXPO_PUBLIC_OFFLINE_PREVIEW','SKOPJE_PARKING_DEVICE_TEST','SKOPJE_PARKING_TEST_PACKAGE','NODE_ENV','CI')) {
    $parkingSavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:EXPO_PUBLIC_OFFLINE_PREVIEW = $(if ($OfflinePreview) { '1' } else { '0' })
    if (-not $OfflinePreview) { $env:EXPO_PUBLIC_API_URL = $ApiUrl }
    $env:CI = '1'
    $env:SKOPJE_PARKING_DEVICE_TEST = $(if ($DeviceTest) { '1' } else { '0' })
    $env:SKOPJE_PARKING_TEST_PACKAGE = $(if ($TestPackage) { '1' } else { '0' })
    Push-Location $parkingBuildRoot
    try {
        & npm.cmd ci --include=dev
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
        $env:NODE_ENV = 'production'
        & npx.cmd expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Expo Android project generation failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $parkingBuildRoot 'android')
    try {
        & .\gradlew.bat app:assembleRelease --no-daemon --max-workers=2 --console=plain '-Pkotlin.compiler.execution.strategy=in-process' '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m'
        if ($LASTEXITCODE -ne 0) { throw 'Android APK compilation failed.' }
    } finally {
        try {
            & .\gradlew.bat --stop --console=plain
            if ($LASTEXITCODE -ne 0) { Write-Warning 'Gradle shutdown failed; inspect remaining builder processes.' }
        } catch {
            Write-Warning "Gradle shutdown could not run: $_"
        } finally { Pop-Location }
    }
    $parkingPreviewRoot = Join-Path $parkingProjectRoot 'preview'
    New-Item -ItemType Directory -Path $parkingPreviewRoot -Force | Out-Null
    $parkingApkPath = Join-Path $parkingPreviewRoot $(if ($DeviceTest) { 'SkopjeParking-device-test.apk' } elseif ($TestPackage) { 'SkopjeParking-test-connected.apk' } elseif ($OfflinePreview) { 'ParkSkopje-preview.apk' } else { 'SkopjeParking-connected.apk' })
    Copy-Item -LiteralPath (Join-Path $parkingBuildRoot 'android\app\build\outputs\apk\release\app-release.apk') -Destination $parkingApkPath -Force
    Get-FileHash -LiteralPath $parkingApkPath -Algorithm SHA256
} finally {
    Write-Host "Build logs and generated project retained at $parkingBuildRoot"
    foreach ($name in $parkingSavedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $parkingSavedEnvironment[$name], 'Process')
    }
}
