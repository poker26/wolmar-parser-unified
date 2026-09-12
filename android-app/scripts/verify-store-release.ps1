[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$androidDir = Split-Path -Parent $PSScriptRoot
$repositoryDir = Split-Path -Parent $androidDir
$shortDrive = "N:"
$createdShortDrive = $false

function Find-JavaTool([string]$Name) {
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $candidate = Join-Path $env:JAVA_HOME "bin\$Name"
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    $candidate = Get-ChildItem "C:\Program Files\Microsoft\jdk-17*\bin\$Name" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate) {
        return $candidate.FullName
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "$Name was not found."
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

try {
    $java = Find-JavaTool "java.exe"
    $jarsigner = Find-JavaTool "jarsigner.exe"
    $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java)

    $sdkDir = if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) {
        Join-Path $env:LOCALAPPDATA "Android\Sdk"
    } else {
        $env:ANDROID_HOME
    }
    $buildTools = Get-ChildItem (Join-Path $sdkDir "build-tools") -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $buildTools) {
        throw "Android build-tools were not found in $sdkDir."
    }
    $aapt = Join-Path $buildTools.FullName "aapt.exe"
    $apksigner = Join-Path $buildTools.FullName "apksigner.bat"

    if (-not (Test-Path -LiteralPath "$shortDrive\")) {
        Invoke-Checked "subst.exe" @($shortDrive, $repositoryDir)
        $createdShortDrive = $true
    }
    $shortAndroidDir = "$shortDrive\android-app"
    if (-not (Test-Path -LiteralPath $shortAndroidDir)) {
        throw "$shortDrive does not point to $repositoryDir."
    }

    if (-not $SkipBuild) {
        Push-Location $shortAndroidDir
        try {
            Invoke-Checked ".\gradlew.bat" @(
                ":app:testDebugUnitTest",
                ":app:lintRelease",
                ":app:assembleRelease",
                ":app:bundleRelease",
                "--no-daemon",
                "--console=plain"
            )
        } finally {
            Pop-Location
        }
    }

    $testDir = Join-Path $androidDir "app\build\test-results\testDebugUnitTest"
    $testReports = @(Get-ChildItem $testDir -Filter "TEST-*.xml")
    if ($testReports.Count -eq 0) {
        throw "No unit-test reports were found."
    }
    $tests = 0
    $failures = 0
    $errors = 0
    foreach ($report in $testReports) {
        [xml]$suite = Get-Content -Raw $report.FullName
        $tests += [int]$suite.testsuite.tests
        $failures += [int]$suite.testsuite.failures
        $errors += [int]$suite.testsuite.errors
    }
    if ($failures -ne 0 -or $errors -ne 0) {
        throw "Unit tests failed: tests=$tests failures=$failures errors=$errors."
    }

    $lintPath = Join-Path $androidDir "app\build\reports\lint-results-release.xml"
    [xml]$lint = Get-Content -Raw $lintPath
    $lintErrors = @($lint.issues.issue | Where-Object { $_.severity -eq "Error" })
    if ($lintErrors.Count -ne 0) {
        throw "Android Lint reported $($lintErrors.Count) errors."
    }

    $manifestPath = Join-Path $androidDir "app\build\intermediates\merged_manifests\release\processReleaseManifest\AndroidManifest.xml"
    [xml]$manifest = Get-Content -Raw $manifestPath
    $androidNamespace = "http://schemas.android.com/apk/res/android"
    $application = $manifest.manifest.application
    if ($application.GetAttribute("allowBackup", $androidNamespace) -ne "false") {
        throw "Release manifest must disable Android backup."
    }
    if ($application.GetAttribute("fullBackupContent", $androidNamespace) -ne "false") {
        throw "Release manifest must disable legacy full backup."
    }
    if ($application.GetAttribute("dataExtractionRules", $androidNamespace) -ne "@xml/data_extraction_rules") {
        throw "Release manifest must define data-extraction rules."
    }
    if ($application.GetAttribute("networkSecurityConfig", $androidNamespace) -ne "@xml/network_security_config") {
        throw "Release manifest must define the network-security configuration."
    }

    $apk = Join-Path $shortAndroidDir "app\build\outputs\apk\release\app-release.apk"
    $aab = Join-Path $shortAndroidDir "app\build\outputs\bundle\release\app-release.aab"
    if (-not (Test-Path -LiteralPath $apk) -or -not (Test-Path -LiteralPath $aab)) {
        throw "Release APK or AAB is missing."
    }

    $badgingOutput = @(& $aapt dump badging $apk)
    $badgingExitCode = $LASTEXITCODE
    $badging = $badgingOutput | Where-Object { $_ -like "package: name=*" } | Select-Object -First 1
    if ($badgingExitCode -ne 0 -or $badging -notmatch "package: name='ru\.begemot26\.numismat' versionCode='([0-9]+)' versionName='([^']+)'") {
        throw "Could not verify the package name and version."
    }
    $versionCode = $Matches[1]
    $versionName = $Matches[2]

    $permissionOutput = @(& $aapt dump permissions $apk)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect APK permissions."
    }
    $permissions = @(
        $permissionOutput |
            Where-Object { $_ -match "^uses-permission: name='([^']+)'$" } |
            ForEach-Object { [regex]::Match($_, "^uses-permission: name='([^']+)'$").Groups[1].Value }
    )
    $allowedPermissions = @(
        "android.permission.INTERNET",
        "ru.begemot26.numismat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
    )
    $unexpectedPermissions = @($permissions | Where-Object { $_ -notin $allowedPermissions })
    if ("android.permission.INTERNET" -notin $permissions -or $unexpectedPermissions.Count -ne 0) {
        throw "Unexpected APK permissions: $($unexpectedPermissions -join ', ')."
    }

    Invoke-Checked $apksigner @("verify", "--print-certs", $apk)
    $aabVerification = @(& $jarsigner -verify $aab 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not ($aabVerification -match "jar verified\.")) {
        throw "AAB signature verification failed."
    }

    $apkSource = Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
    $aabSource = Join-Path $androidDir "app\build\outputs\bundle\release\app-release.aab"
    if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        $apkOutput = Join-Path $OutputDirectory "numismat-$versionName-store-ready.apk"
        $aabOutput = Join-Path $OutputDirectory "numismat-$versionName-store-ready.aab"
        Copy-Item -LiteralPath $apkSource -Destination $apkOutput -Force
        Copy-Item -LiteralPath $aabSource -Destination $aabOutput -Force
        $apkSource = $apkOutput
        $aabSource = $aabOutput
    }

    Write-Output "Release verified: version=$versionName code=$versionCode tests=$tests lintErrors=0"
    Get-FileHash -Algorithm SHA256 $apkSource, $aabSource |
        Select-Object Path, Hash
} finally {
    if ($createdShortDrive) {
        & subst.exe $shortDrive /D | Out-Null
    }
}
