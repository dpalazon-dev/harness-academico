# Compila el instalador de Windows desde un commit de este repositorio, en un
# worktree aparte, y por defecto lo instala y precalienta el primer arranque.
param(
    [Parameter(Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Commit = 'refs/heads/main',
    # Worktree de compilación; por defecto, la carpeta «compilado» junto al repositorio.
    [string]$Compilado,
    [switch]$SoloCompilar,
    [switch]$SinPrecalentar
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$build = if ($Compilado) { [IO.Path]::GetFullPath($Compilado) } else { Join-Path (Split-Path -Parent $repo) 'compilado' }
$timer = [Diagnostics.Stopwatch]::StartNew()
$step = 'Preparar el worktree'
$locked = $false
$mutex = [Threading.Mutex]::new($false, 'Local\HarnessAcademico-Compilar')

function Invoke-Git {
    & git -c core.fsmonitor=false @args
    if ($LASTEXITCODE -ne 0) { throw "Git terminó con código $LASTEXITCODE." }
}

function Invoke-Npm {
    & npm.cmd @args
    if ($LASTEXITCODE -ne 0) { throw "npm terminó con código $LASTEXITCODE." }
}

# Tras instalar, Windows (Defender) comprueba por primera vez cada archivo nuevo
# cuando la app los abre: el primer arranque medido tardaba 27-40 s y a veces
# agotaba el plazo (ticket 07). Arrancar una vez la copia instalada con un
# perfil y carpetas TEMPORALES paga ese coste aquí y no al abrir la app.
# Nunca toca los datos reales: las cuatro rutas van por variables de entorno
# hacia carpetas vacías, así que rutas.json y el cerrojo reales no se leen.
# Un fallo del precalentamiento avisa pero no invalida la instalación.
function Invoke-Precalentamiento {
    param([string]$Directorio)
    $exe = Join-Path $Directorio 'HarnessAcademico.exe'
    $rutasReales = Join-Path $env:APPDATA 'HarnessAcademico\rutas.json'
    $uv = $null
    if (Test-Path -LiteralPath $rutasReales) {
        try { $uv = (Get-Content -LiteralPath $rutasReales -Raw | ConvertFrom-Json).uv } catch { }
    }
    if (-not $uv -or -not (Test-Path -LiteralPath $uv -PathType Leaf)) { $uv = Join-Path $env:USERPROFILE '.local\bin\uv.exe' }
    if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {
        Write-Warning 'Sin precalentar: no encuentro uv.exe.'
        return
    }
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('harnessacademico-precalentar-' + [guid]::NewGuid().ToString('N'))
    $names = 'LH_DATA_DIR', 'ESTUDIO_KB_DIR', 'KBOL_ALMACEN', 'ESTUDIO_UV'
    $previous = @{}
    foreach ($n in $names) { $previous[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
    $started = $null
    try {
        $perfil = Join-Path $temp 'perfil'
        $values = @{ LH_DATA_DIR = (Join-Path $temp 'datos'); ESTUDIO_KB_DIR = (Join-Path $temp 'conocimiento'); KBOL_ALMACEN = (Join-Path $temp 'almacen'); ESTUDIO_UV = $uv }
        foreach ($n in 'LH_DATA_DIR', 'ESTUDIO_KB_DIR', 'KBOL_ALMACEN') { New-Item -ItemType Directory -Force -Path $values[$n] | Out-Null }
        New-Item -ItemType Directory -Force -Path $perfil | Out-Null
        foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $values[$n], 'Process') }
        Write-Host 'Precalentando el primer arranque (perfil temporal, puede tardar medio minuto)...'
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $started = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$perfil`"" -PassThru
        $log = Join-Path $perfil 'logs\main.log'
        $ready = $false
        while ($clock.Elapsed.TotalSeconds -lt 180 -and -not $started.HasExited) {
            if ((Test-Path -LiteralPath $log) -and (Select-String -LiteralPath $log -Pattern 'window open' -Quiet)) { $ready = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if ($ready) {
            Write-Host ("Primer arranque listo en {0:N1} s." -f $clock.Elapsed.TotalSeconds)
            Start-Sleep -Seconds 3
        } else {
            Write-Warning 'El arranque de precalentamiento no terminó; la instalación sigue siendo válida.'
        }
        # Una petición de cierre enviada con la ventana aún cargando puede perderse
        # (se vio con la primera carga en frío): se repite cada 6 s, hasta 4 veces.
        for ($try = 0; $try -lt 4 -and (Get-Process -Id $started.Id -ErrorAction SilentlyContinue); $try++) {
            & taskkill.exe /PID $started.Id | Out-Null
            $close = [Diagnostics.Stopwatch]::StartNew()
            while ($close.Elapsed.TotalSeconds -lt 6 -and (Get-Process -Id $started.Id -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
        }
    } catch {
        Write-Warning "Precalentamiento fallido: $($_.Exception.Message)"
    } finally {
        foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $previous[$n], 'Process') }
        # Solo lo lanzado aquí: la copia instalada no estaba abierta (se cerró antes de instalar).
        $mine = @(Get-Process -Name HarnessAcademico -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Directorio, [StringComparison]::OrdinalIgnoreCase) })
        if ($mine.Count -gt 0) {
            Write-Warning "Quedaban $($mine.Count) procesos del arranque de prueba; los cierro."
            $mine | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    try { $locked = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Ya hay una compilación en marcha.' }

    $sha = Invoke-Git -C $repo rev-parse --verify --end-of-options "${Commit}^{commit}"
    if (-not (Test-Path -LiteralPath $build)) {
        Invoke-Git -C $repo worktree add --detach $build $sha
    }
    $buildItem = Get-Item -LiteralPath $build
    if ($buildItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "El worktree es un enlace: $build."
    }
    $actualRoot = Invoke-Git -C $build rev-parse --show-toplevel
    $actualCommon = Invoke-Git -C $build rev-parse --path-format=absolute --git-common-dir
    $expectedCommon = Invoke-Git -C $repo rev-parse --path-format=absolute --git-common-dir
    if ([IO.Path]::GetFullPath($actualRoot) -ne [IO.Path]::GetFullPath($build) -or $actualCommon -ne $expectedCommon) {
        throw "La carpeta no es el worktree de compilación de este repositorio: $build."
    }
    if (Invoke-Git -C $build status --porcelain) {
        throw "Hay cambios sin confirmar en $build."
    }
    Invoke-Git -C $build switch --detach $sha

    Push-Location -LiteralPath $build
    try {
        $step = 'Comprobar las dependencias'
        $manifest = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
        if (-not $manifest.scripts.'desktop:dist:win') { throw 'Este commit no incluye desktop:dist:win.' }
        $plugins = @(Get-ChildItem -LiteralPath plugins -Directory | Where-Object {
            Test-Path -LiteralPath (Join-Path $_.FullName 'package.json')
        } | Sort-Object Name)
        $lockfiles = @('package-lock.json') + @($plugins | ForEach-Object {
            Join-Path $_.FullName 'package-lock.json'
        })
        $signature = (@($lockfiles | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash }) -join ' ')
        $stamp = Join-Path $build 'node_modules\.harnessacademico-locks'
        $existing = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() }
        $missing = @($plugins | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $_.FullName 'node_modules'))
        }).Count -gt 0
        if ($signature -ne $existing -or $missing -or -not (Test-Path -LiteralPath 'node_modules\electron\package.json')) {
            $step = 'Instalar las dependencias fijadas en los lockfiles'
            Invoke-Npm ci
            Invoke-Npm run plugins:setup
            Set-Content -LiteralPath $stamp -Value $signature -Encoding ascii
        }

        $step = 'Compilar y comprobar el instalador'
        Invoke-Npm run desktop:dist:win
        $installer = Join-Path $build "dist\HarnessAcademico-$($manifest.version)-x64-setup.exe"
        if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Falta $installer." }
    } finally {
        Pop-Location
    }

    if ($SoloCompilar) {
        Write-Host "Compilado $sha en $($timer.Elapsed). Instalador: $installer"
        return
    }

    $step = 'Cerrar HarnessAcademico antes de instalar'
    $running = @(Get-Process -Name HarnessAcademico -ErrorAction SilentlyContinue)
    foreach ($app in $running | Where-Object MainWindowHandle -ne 0) {
        [void]$app.CloseMainWindow()
    }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while (Get-Process -Name HarnessAcademico -ErrorAction SilentlyContinue) {
        if ($deadline.Elapsed.TotalSeconds -ge 15) { throw 'Cierra HarnessAcademico y vuelve a ejecutar la compilación.' }
        Start-Sleep -Milliseconds 250
    }

    $step = 'Instalar HarnessAcademico'
    $setup = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "El instalador terminó con código $($setup.ExitCode)." }
    Write-Host "Instalado $sha en $($timer.Elapsed)."
    if (-not $SinPrecalentar) {
        $step = 'Precalentar el primer arranque'
        Invoke-Precalentamiento -Directorio (Join-Path $env:LOCALAPPDATA 'Programs\harnessacademico')
        Write-Host "Listo en $($timer.Elapsed)."
    }
} catch {
    throw "Falló el paso «$step». $($_.Exception.Message)"
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
