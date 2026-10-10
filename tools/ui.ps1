param([ValidateSet('dev', 'build', 'preview', 'install', 'desktop:dev', 'desktop:build')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
    if (Test-Path -LiteralPath (Join-Path $bundledNode 'node.exe')) {
        $env:PATH = $bundledNode + [IO.Path]::PathSeparator + $env:PATH
    } else { throw 'Install Node.js 22.12+ or 24 LTS to run the interface.' }
}
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if ($pnpmCommand) { $pnpmExecutable = $pnpmCommand.Source }
else {
    $pnpmExecutable = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
    if (-not (Test-Path -LiteralPath $pnpmExecutable)) { throw 'Install pnpm, then run this task again.' }
}
# Child build commands must find the same package manager and Rust installation.
$env:PATH = (Split-Path -Parent $pnpmExecutable) + [IO.Path]::PathSeparator + $env:PATH
if ($Mode.StartsWith('desktop:')) {
    $cargoBin = Join-Path $env:USERPROFILE '.cargo/bin'
    if (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe')) {
        $env:PATH = $cargoBin + [IO.Path]::PathSeparator + $env:PATH
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Install Rust (MSVC) and Microsoft C++ Build Tools. See README.md.'
    }
}
if ($Mode -eq 'install') { & $pnpmExecutable install --frozen-lockfile }
else { & $pnpmExecutable run $Mode }
exit $LASTEXITCODE
