[CmdletBinding()]
param(
    [string]$KeytoolPath,
    [string]$DistinguishedName = "CN=Numismat, OU=Mobile, O=Begemot26, L=Moscow, C=RU"
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$signingDir = Join-Path $projectDir "signing"
$keystorePath = Join-Path $signingDir "numismat-release.p12"
$propertiesPath = Join-Path $signingDir "keystore.properties"

if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw "Release signing files already exist; refusing to replace the signing identity."
}

if ([string]::IsNullOrWhiteSpace($KeytoolPath)) {
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $candidate = Join-Path $env:JAVA_HOME "bin\keytool.exe"
        if (Test-Path -LiteralPath $candidate) {
            $KeytoolPath = $candidate
        }
    }
}
if ([string]::IsNullOrWhiteSpace($KeytoolPath)) {
    $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($command) {
        $KeytoolPath = $command.Source
    }
}
if ([string]::IsNullOrWhiteSpace($KeytoolPath) -or -not (Test-Path -LiteralPath $KeytoolPath)) {
    throw "keytool.exe was not found. Pass -KeytoolPath or set JAVA_HOME."
}

New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
$secretBytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$password = [Convert]::ToBase64String($secretBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$env:NUMISMAT_KEYSTORE_SECRET = $password

try {
    $keytoolArguments = @(
        "-genkeypair"
        "-keystore", $keystorePath
        "-storetype", "PKCS12"
        "-storepass:env", "NUMISMAT_KEYSTORE_SECRET"
        "-keypass:env", "NUMISMAT_KEYSTORE_SECRET"
        "-alias", "numismat"
        "-keyalg", "RSA"
        "-keysize", "4096"
        "-validity", "10000"
        "-dname", $DistinguishedName
    )
    & $KeytoolPath @keytoolArguments
    if ($LASTEXITCODE -ne 0) {
        throw "keytool failed with exit code $LASTEXITCODE"
    }

    $properties = @(
        "storeFile=numismat-release.p12"
        "storePassword=$password"
        "keyAlias=numismat"
        "keyPassword=$password"
        ""
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($propertiesPath, $properties, [Text.UTF8Encoding]::new($false))
} catch {
    if (Test-Path -LiteralPath $keystorePath) {
        Remove-Item -LiteralPath $keystorePath -Force
    }
    throw
} finally {
    Remove-Item Env:\NUMISMAT_KEYSTORE_SECRET -ErrorAction SilentlyContinue
    [Array]::Clear($secretBytes, 0, $secretBytes.Length)
    $password = $null
}

Write-Output "Created a new release signing identity in $signingDir"
Write-Output "Back up both private files securely. Losing this key prevents future in-place updates."
