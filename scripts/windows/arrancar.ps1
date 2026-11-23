# Arranca HarnessAcademico en modo desarrollo desde este repositorio (Windows).
# Electron toma el cerrojo de datos antes de iniciar su propio servidor Next.
# Las carpetas de datos se pasan como parámetros o con las variables
# LH_DATA_DIR, ESTUDIO_KB_DIR y KBOL_ALMACEN; sin ellas, la app usa sus valores por defecto.
param(
    [string]$Datos,
    [string]$Conocimiento,
    [string]$Almacen
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electron -PathType Leaf)) {
    throw "Faltan las dependencias de desarrollo en $app (ejecuta npm ci y npm run plugins:setup)."
}

if ($Datos) { $env:LH_DATA_DIR = $Datos }
if ($Conocimiento) { $env:ESTUDIO_KB_DIR = $Conocimiento }
if ($Almacen) { $env:KBOL_ALMACEN = $Almacen }
if (!$env:LH_DATA_DIR) { Write-Warning 'Sin LH_DATA_DIR: la app usará su carpeta de datos por defecto.' }
$env:LH_DEV_NODE = $node
Push-Location -LiteralPath $app
try {
    npm.cmd run plugins:build-core
    if ($LASTEXITCODE) { throw 'No se pudieron compilar los plugins.' }
    npm.cmd run plugins:build-authoring
    if ($LASTEXITCODE) { throw 'No se pudo preparar el kit de plugins.' }
    $shell = Start-Process -FilePath $electron -ArgumentList "`"$app`" --lh-managed-dev" -WorkingDirectory $app -Wait -PassThru
    if ($shell.ExitCode) {
        throw "HarnessAcademico terminó con código $($shell.ExitCode). Consulta %APPDATA%\HarnessAcademico-dev\logs\main.log."
    }
} finally {
    Pop-Location
}
