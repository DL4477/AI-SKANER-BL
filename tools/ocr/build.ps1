param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
& $Python -c 'import sys; assert sys.version_info[:2] == (3,12), "Build requires Python 3.12 x64"; assert sys.maxsize > 2**32'
if ($LASTEXITCODE) { throw 'Python 3.12 x64 is required only on the build machine.' }
$venvPython = Join-Path $root '.local/ocr-venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $Python -m venv .local/ocr-venv
    if ($LASTEXITCODE) { throw 'Cannot create build environment.' }
}
& $venvPython -m pip install --use-deprecated=legacy-certs --index-url https://pypi.org/simple -r tools/ocr/requirements-win.lock
if ($LASTEXITCODE) { throw 'Cannot install pinned OCR dependencies.' }
& $venvPython tools/ocr/fetch-assets.py
if ($LASTEXITCODE) { throw 'OCR asset verification failed.' }
& $venvPython tools/ocr/collect-licenses.py
if ($LASTEXITCODE) { throw 'Cannot collect third-party notices.' }
$assetInput = (Join-Path $root '.local/ocr-assets') + ':ocr-assets'
$licenseInput = (Join-Path $root '.local/ocr-licenses') + ':licenses'
& $venvPython -m PyInstaller --noconfirm --clean --onedir --console --name ocr-worker --distpath .local/ocr-dist --workpath .local/ocr-build --specpath .local --collect-all rapidocr --collect-all onnxruntime --collect-all tesserocr --copy-metadata rapidocr --copy-metadata onnxruntime --add-data $assetInput --add-data $licenseInput tools/ocr/worker.py
if ($LASTEXITCODE) { throw 'OCR packaging failed.' }
$status = '{"mode":"status"}' | & .local/ocr-dist/ocr-worker/ocr-worker.exe | ConvertFrom-Json
if (-not $status.ok) { throw 'Packaged OCR cannot start.' }
Write-Host 'Packaged CPU OCR is ready. Python is not needed by the installed application.'
