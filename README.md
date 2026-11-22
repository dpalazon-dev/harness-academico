# HarnessAcademico

**A desktop study app where the AI tutor critiques what you produce instead of producing it for you.**

[Español](README.es.md) · [Download](https://github.com/dpalazon-dev/harness-academico/releases/latest) · [First run](docs/first-run.md) · [Contributing](CONTRIBUTING.md) · [Discussions](https://github.com/dpalazon-dev/harness-academico/discussions)

HarnessAcademico organises study around what you want to be able to *do*. Each subject becomes a plan of units; each unit names a capability and the observable criterion that shows you have it. You write first (what you already know, your notes from a source, your reconstruction without looking) and the tutor contrasts, questions and points out gaps. Practice attempts and spaced reviews come from that evidence, not from flashcards you did not write.

It is a modified version of [LearnHarness](https://github.com/amosblomqvist/learnharness) 0.6.0 by Amos Blomqvist, under the same AGPL-3.0-only licence. The interface is in **Spanish**. Credits and licences are in [NOTICE.md](NOTICE.md).

## What it does

- **Spaces, plans and units.** One space per subject, with its plan, units, documents, notebooks and conversations. The tutor can propose plan changes or new units; nothing changes until you confirm.
- **A learning cycle, not a pipeline.** Initial dump before reading, capture from sources, reconstruction without the source, contrast and repair, then use and spaced retrieval. The app suggests the next step with a one-line reason and never blocks the others.
- **Practice that counts as evidence.** An attempt is declared confidence, an answer written without the source, a contrast and a self-assessment. The answer is frozen before you see the reference. Review intervals follow from those attempts.
- **Library.** Attach PDFs and read them page by page, with notes that keep their locator.
- **Notebooks.** Write in your own words; the tutor annotates in the margin, can draw a Mermaid diagram when you ask, and offers retrieval questions or facts that only enter your notebook when you accept them. A proactive mode decides whether it comments on its own. Comments can be read aloud with local Windows voices only.
- **Knowledge base.** Confirmed facts, each with its citation, are stored as plain files in a git repository in KBOL format. Optional: everything else works without it. Importing PDFs and validating the base need the KBOL tools and [uv](https://docs.astral.sh/uv/); the app says what is missing when you use them.
- **Your models, your data.** Bring an API key, a supported subscription sign-in, the Claude Code CLI or an OpenAI-compatible endpoint (including a local server). Your data lives in folders you choose, as plain JSON and Markdown.

## Install (Windows x64)

1. Download `HarnessAcademico-<version>-x64-setup.exe` from [Releases](https://github.com/dpalazon-dev/harness-academico/releases/latest) and run it. The installer is **unsigned**, so Windows SmartScreen will warn about an unknown publisher: choose *More info → Run anyway*.
2. On first launch the app asks where to keep your data (default `Documents\HarnessAcademico`) and creates three folders there. Choosing *Salir* creates nothing.
3. Configure a model in *Ajustes* and create your first space.

The first launch after installing can take 30 seconds or more while Windows Defender scans the new files; a *Preparando HarnessAcademico…* window shows meanwhile. Later launches take about 3 seconds.

Details, optional settings and how to remove the app: [docs/first-run.md](docs/first-run.md).

macOS and Linux targets are inherited from LearnHarness but have not been built or tested in this fork. Running from source may work there; reports are welcome.

## Privacy

- Your study data stays in the folders you chose. The app does not copy or sync them.
- Model requests send the context the task needs to the provider you configured. Local storage does not mean offline processing.
- API keys and sign-in tokens are stored in `%APPDATA%\HarnessAcademico`, outside your data folders.
- There is no telemetry and no automatic update feed.

## Run from source

Requires Node 26, npm and Git. In PowerShell:

```powershell
npm ci
npm run plugins:setup
npm run dev                                          # terminal 1: dev server on http://localhost:3000
$env:LH_DEV_URL="http://localhost:3000"; npx electron .   # terminal 2: desktop window
npm test
npm run desktop:dist:win                             # Windows installer in dist/ (needs a clean git tree)
```

Without `LH_DATA_DIR`, development data goes to `data/` in the checkout.

See [development](docs/development.md), [architecture](docs/architecture.md) and the [plugin authoring guide](docs/plugin-authoring.md). Most of the study features live in the `estudio` plugin ([plugins/estudio](plugins/estudio)). Domain vocabulary (in Spanish) is in [GLOSSARY.md](GLOSSARY.md); differences from LearnHarness are listed in [docs/sistema-comun/divergencias.md](docs/sistema-comun/divergencias.md).

## Support

- Bugs: [Issues](https://github.com/dpalazon-dev/harness-academico/issues).
- Questions and ideas: [Discussions](https://github.com/dpalazon-dev/harness-academico/discussions).
- Security problems: report privately as described in [SECURITY.md](SECURITY.md).

Issues and discussions are welcome in English or Spanish.

## Licence

[AGPL-3.0-only](LICENSE). Modified work notice and third-party credits: [NOTICE.md](NOTICE.md).
