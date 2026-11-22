# Contributing to HarnessAcademico

Bug reports, focused fixes, documentation, translations, reviews and testing are welcome. HarnessAcademico is maintained by one person, David Palazón, with a deliberate teaching method: the tutor critiques what the learner produces instead of producing it. English and Spanish are both fine everywhere.

## Where to start

- **Issues** labelled [`good first issue`](https://github.com/dpalazon-dev/harness-academico/labels/good%20first%20issue) are small and self-contained.
- **[Discussions](https://github.com/dpalazon-dev/harness-academico/discussions)** are for questions, ideas and design proposals.
- **[Issues](https://github.com/dpalazon-dev/harness-academico/issues)** are for concrete bugs and agreed work.

Discuss changes to the study method, the tutor's behaviour, the data format or the core architecture **before** implementing them. A fix restores intended behaviour; changing what the intended behaviour is counts as a design proposal. If you are unsure which one you have, ask in Discussions first.

Optional capabilities belong in plugins where possible. See the [plugin authoring guide](docs/plugin-authoring.md).

## Setting up

Requires Node 26, npm and Git. Windows is the tested platform. In PowerShell:

```powershell
npm ci
npm run plugins:setup
npm run dev                                          # terminal 1
$env:LH_DEV_URL="http://localhost:3000"; npx electron .   # terminal 2
```

In development, usage data goes to `data/` in the checkout unless `LH_DATA_DIR` is set. The knowledge base defaults to `%USERPROFILE%\Learning` and imported PDFs to `%USERPROFILE%\.kbol\learning\almacen`; point `ESTUDIO_KB_DIR` and `KBOL_ALMACEN` at test folders in terminal 1 to keep them apart from any real data.

(`npm run desktop:dev` uses POSIX environment syntax and only works in a POSIX shell.) To stop the dev server completely on Windows, close every `node.exe` started from your checkout; see "Arranque en Windows" in [divergencias.md](docs/sistema-comun/divergencias.md).

Before opening a pull request, run:

```sh
npm run typecheck
npm test
npm run lint
```

and, if you touched the `estudio` plugin, `npm test` inside `plugins/estudio`. After changing plugin code, `npm run plugins:build-core` refreshes the copy the server loads.

Where things are:

- `plugins/estudio`: spaces, plans, units, practice, library, notebooks and knowledge base.
- `electron/`: the desktop shell (startup, paths, first run, data lock).
- `app/`, `components/`: the Next.js interface.
- `GLOSSARY.md`: the domain vocabulary (Spanish). Use these terms in code and interface text.
- `docs/sistema-comun/divergencias.md`: what differs from LearnHarness and why.

## Pull requests

Keep each pull request focused on one problem, with the tests and documentation that change needs. Leave unrelated refactors, formatting and dependency updates for separate pull requests.

In the description, explain:

- the problem, linking the issue or discussion if there is one;
- what changed and why it solves the problem;
- how you verified it, including what you did not test (for example, whether you used a real model or mocked responses).

Interface text is in Spanish from Spain. Write it plainly, without jargon.

AI-assisted and hand-written contributions follow the same standards; you are responsible for the accuracy of the code, tests and description.

## Bug reports

Include the app version, Windows version, what you did, what you expected and what happened. A log excerpt from `%APPDATA%\HarnessAcademico\logs\main.log` helps. Never publish credentials, `auth.json`, private study records or course materials you cannot share; use synthetic examples instead.

## Review

The maintainer decides what is accepted. Review may ask for changes, a narrower scope, more discussion or a decision not to proceed. Passing tests do not by themselves show that a behaviour belongs in the product. Parts of a pull request may be adopted with finishing changes, keeping authorship and credit.

## Licence

By contributing, you agree that your contribution is licensed under [AGPL-3.0-only](LICENSE), like the rest of the project.
