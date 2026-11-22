# First run on Windows

This guide covers installing HarnessAcademico, choosing where your data lives, the optional settings and how to remove the app. For models, dictation and files, see [Getting started](getting-started.md).

## 1. Install

Download `HarnessAcademico-<version>-x64-setup.exe` from [Releases](https://github.com/dpalazon-dev/harness-academico/releases/latest) and run it. It installs for your user only, in `%LOCALAPPDATA%\Programs\harnessacademico`, without asking for administrator rights.

The installer is not signed. SmartScreen shows "Windows protected your PC": choose **More info → Run anyway**. You can check the download against the SHA-256 listed in the release notes:

```powershell
Get-FileHash .\HarnessAcademico-*-x64-setup.exe -Algorithm SHA256
```

## 2. Choose your data folder

On the first launch the app asks where to keep your data. The default is `Documents\HarnessAcademico`.

- **Usar esta carpeta** creates `datos`, `conocimiento` and `almacen` inside it and writes the paths to `%APPDATA%\HarnessAcademico\rutas.json`.
- **Elegir otra carpeta…** lets you pick another base folder first.
- **Salir** closes the app and creates nothing.

| Folder | Contents |
|---|---|
| `datos` | Conversations, spaces, units, practice, notebooks and settings. |
| `conocimiento` | The knowledge base: a git repository in KBOL format. Each confirmed batch is a local commit; nothing is pushed anywhere. |
| `almacen` | Imported PDFs and their processed text. |

The first launch after installing can take 30 seconds or more while Windows Defender scans the new files. A *Preparando HarnessAcademico…* window appears after 4 seconds; the app waits up to 120 seconds. Closing that window cancels the launch. Later launches take about 3 seconds.

## 3. Configure a model

Open **Ajustes** from the sidebar and connect at least one model: a provider API key, a supported subscription sign-in, the [Claude Code CLI](claude-code.md) or a [custom OpenAI-compatible endpoint](custom-providers.md). Then assign the Strong, Cheap and Vision slots. The interface opens without a model, but the tutor needs one.

## 4. Start studying

Create a space for a subject, state what you want to be able to do, and let the tutor propose a plan of units. Inside a unit, start with the initial dump: write what you already know before reading anything.

## Optional: `rutas.json`

`%APPDATA%\HarnessAcademico\rutas.json` holds the paths. You can edit it with the app closed.

```json
{
  "datos": "C:\\Users\\you\\Documents\\HarnessAcademico\\datos",
  "conocimiento": "C:\\Users\\you\\Documents\\HarnessAcademico\\conocimiento",
  "almacen": "C:\\Users\\you\\Documents\\HarnessAcademico\\almacen",
  "uv": "C:\\Users\\you\\.local\\bin\\uv.exe",
  "nombre": "Lucía"
}
```

| Key | Required | Meaning | Server variable |
|---|---|---|---|
| `datos` | yes | Usage data folder (must exist) | `LH_DATA_DIR` |
| `conocimiento` | yes | Knowledge base folder (must exist) | `ESTUDIO_KB_DIR` |
| `almacen` | yes | Imported PDFs folder (must exist) | `KBOL_ALMACEN` |
| `uv` | no | Path to `uv.exe`. If given, it must exist. The first run fills it in when it finds `uv.exe` in `PATH` or `~\.local\bin`; if absent, the app runs `uv` from `PATH` | `ESTUDIO_UV` |
| `nombre` | no | How the tutor and the knowledge base call you (one line, 60 characters at most). Default: your Windows user name with a capital first letter | `ESTUDIO_NOMBRE` |

- Paths must be absolute; in JSON, backslashes are doubled.
- An environment variable with the server variable's name wins over the file.
- If the file is invalid or a path does not exist, the app shows which key and path are wrong and does not start.

## Optional: PDF import and knowledge base validation

Importing PDFs (Docling) and validating the knowledge base use the KBOL tools through [uv](https://docs.astral.sh/uv/). The app expects KBOL in `%USERPROFILE%\KBOL`, or in the folder named by the `ESTUDIO_KBOL_DIR` environment variable. Without them the rest of the app works, and these two actions explain what is missing.

## Only one copy at a time

The app writes `datos\harnessacademico.lock` while it is open and refuses to start a second copy on the same data. If the app was closed abruptly, the next launch replaces the stale lock. If you back up or sync the `datos` folder, leave that file out.

## Where things are

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\Programs\harnessacademico` | The installed app. |
| `%APPDATA%\HarnessAcademico` | `rutas.json`, window state, logs (`logs\main.log`) and account credentials (`auth.json`). Not your study data. |
| Your data folder | `datos`, `conocimiento`, `almacen`. |

## Uninstall

Remove **HarnessAcademico** from *Settings → Apps → Installed apps*. The uninstaller removes the program only. Your data folder and `%APPDATA%\HarnessAcademico` (including saved credentials) stay; delete them by hand if you no longer want them.

## Something went wrong

Attach the end of `%APPDATA%\HarnessAcademico\logs\main.log` to an [issue](https://github.com/dpalazon-dev/harness-academico/issues/new/choose), after removing anything private. Never attach `auth.json`, API keys or your study data.
