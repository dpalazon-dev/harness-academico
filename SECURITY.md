# Security policy

HarnessAcademico stores API keys, sign-in tokens, conversations and study records on your computer, and its agent reads files and fetches web content on your behalf. If you find a way to abuse any of that, please report it privately so a fix can ship before the details are public.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Report it through GitHub's private vulnerability reporting:
[Security → Report a vulnerability](https://github.com/dpalazon-dev/harness-academico/security/advisories/new).

A useful report includes:

- the HarnessAcademico version and your Windows version;
- what an attacker can do and what they need first (a web page the agent reads, a PDF the learner imports, network access, and so on);
- steps to reproduce, or a proof of concept;
- any fix or mitigation you have in mind.

## What to expect

This is a one-maintainer project. These are targets, not guarantees:

| Step | Target |
| --- | --- |
| Acknowledge your report | within 7 days |
| Initial assessment (confirmed or not, severity) | within 14 days |
| Fix released and advisory published | within 90 days of the report |

The fix is developed privately in a GitHub security advisory. You will be credited in the advisory unless you prefer to stay anonymous.

If the problem is also in [LearnHarness](https://github.com/amosblomqvist/learnharness), please report it there too, following its own security policy.

## Supported versions

Only the latest release receives security fixes. The app does not update itself: install the new release over the old one.

## Scope

In scope:

- the desktop app (Electron shell, window, IPC, first-run and paths handling);
- the local server the app starts;
- the agent and its tools, including prompt injection from web pages, PDFs or other content that leads to reading, changing or sending your data;
- rendered content such as diagrams, demos and Markdown;
- the release pipeline.

Out of scope:

- attacks that already require running code as your Windows user;
- bugs in third-party model or service providers themselves (report those to the provider);
- automated scanner output without a demonstrated impact on HarnessAcademico.
