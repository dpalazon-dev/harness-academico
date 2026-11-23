# Changelog

All notable changes to HarnessAcademico. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). For changes before the fork, see the [LearnHarness releases](https://github.com/amosblomqvist/learnharness/releases).

## Unreleased

## [0.1.0] - 2026-11-23

First public release of HarnessAcademico, a modified version of LearnHarness 0.6.0 (`v0.6.0`, commit `a636647`). The detailed list of differences is in [docs/sistema-comun/divergencias.md](docs/sistema-comun/divergencias.md).

HarnessAcademico numbers its own releases from 0.1.0. Plugin compatibility still follows the LearnHarness plugin API: `package.json` declares `pluginHostVersion` (0.6.0), and that is the version a plugin's `minAppVersion` is checked against.

### Added

- **Study structure** (`estudio` plugin): spaces per subject, plans of units, each with a capability and an observable criterion. The tutor proposes plan changes and new units; they apply only when you confirm, and a change that no longer fits expires with its reason.
- **Learning cycle:** initial dump, capture from sources, block close with reconstruction and contrast, and a suggested next step per unit with a one-line reason.
- **Practice and review:** attempts with declared confidence, a frozen answer before the reference, contrast and self-assessment; spaced reviews from that evidence. The assessment loop and calibration are adapted from StudyHarness (MIT).
- **Home:** today's units, a calendar agenda of done and pending work, study rhythm, and quick actions under the chat box.
- **Library:** chunked PDF upload, page-by-page reader, notes with page locators linked to the unit you read from, passages sent to the tutor.
- **Notebooks:** a clean page with margin comments from the tutor, threads, a proactive mode with a daily cap, notebook purpose and ink colour, reader personas, offers (retrieval questions, knowledge-base facts, links) that apply only when accepted, Mermaid diagrams on request, and read-aloud with local Windows voices.
- **Knowledge base:** confirmed facts with citations stored as KBOL records in a local git repository; drafts wait in *Por decidir*.
- **Sidebar and navigation:** collapsible sections, *Por decidir* panel with a counter, groupable and filterable conversations, ⌘K/Ctrl+K palette for search and actions, keyboard navigation across the study screens.
- **Progress:** regulator trace, calibration, history per unit and a year of activity.
- **Appearance:** title font selector and a warm light theme, *Papel*.
- **Windows desktop build:** own identity (`HarnessAcademico`, `%APPDATA%\HarnessAcademico`), NSIS installer per user, data paths from `rutas.json`, a first-run dialog that creates the data folders, a data lock so only one copy opens the same data, and a *Preparando HarnessAcademico…* window when the first launch after installing is slow.
- **Learner identity:** the name used by the tutor and the knowledge base comes from the optional `nombre` key or the Windows user name.

### Changed

- The interface is in Spanish (Spain): chat, settings, dialogs, errors and tool cards.
- The tutor's contract: the learner produces, the tutor critiques. Conversations open with the unit and plan as context.
- KBOL is the only long-term memory; the inherited knowledge-graph extraction is off ([ADR 0006](docs/adr/0006-kbol-unica-memoria-y-extraccion-del-grafo-apagada.md)).
- Startup waits up to 120 seconds for the packaged server instead of 30.
- Dependencies brought forward from LearnHarness 0.7.0: Pi 1.5.2 (`pi-agent-core`, `pi-ai`) and Next 16.4.6, with the dependency cleanup that came with them.

### Removed

- Automatic updates and the update feed.
- The seven-tab study view of the first prototype, replaced by the study shell.

### Fixed

- Opening `/chat/<id>` directly no longer returns a 500 error.
- Learner actions saved during context compaction are preserved ([amosblomqvist/learnharness#518](https://github.com/amosblomqvist/learnharness/issues/518)).
- Production dependency advisories in the desktop and `estudio` lockfiles.

### Security

- Security fixes from LearnHarness 0.7.0: hardened desktop IPC, a restricted environment for spawned CLI providers, and stricter handling of ChatGPT credentials.

[0.1.0]: https://github.com/dpalazon-dev/harness-academico/releases/tag/v0.1.0
