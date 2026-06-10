# Security Policy

TrueRate keeps a user's loyalty memberships — and the credentials behind them —
in one place, so we take security seriously. We appreciate responsible
disclosure and will work with you to confirm and fix verified issues.

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, pull requests,
or discussions.**

Report privately through GitHub's built-in private vulnerability reporting:

➡️ **[Open a private report](https://github.com/l-korous/truerate/security/advisories/new)**
(repository **Security** tab → **Report a vulnerability**).

This keeps the report confidential between you and the maintainers until a fix
is released.

A helpful report includes:

- the affected surface (`core`, `api`, `mcp`, `web`, `extension`, `infra`, or a
  deployed URL) and the version/commit you tested,
- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any suggested remediation.

## What to expect

This is a small, fast-moving project, so timelines are best-effort:

- **Acknowledgement** within ~5 business days.
- An initial assessment (confirmed / need-more-info / out-of-scope) once we've
  reproduced it.
- Updates on remediation progress, and a heads-up when a fix ships. With your
  consent we're glad to credit you.

Please give us a reasonable chance to release a fix before any public
disclosure.

## Scope

**In scope** — code in this repository and the surfaces it ships:

- `packages/core` (domain model, **credential encryption**, Cosmos access,
  enrichment engine),
- `apps/api`, `apps/mcp`, `apps/web`, `apps/extension`,
- `infra` (Azure Bicep / deploy),
- the deployed Web / API / MCP endpoints listed in the [README](README.md).

We're especially interested in: exposure or decryption of stored membership
credentials, leakage of a user's personal **MCP URL token** (the token *is* the
credential), authentication/authorization bypass, JWT handling flaws, and
injection.

**Out of scope:**

- vulnerabilities in third-party providers, channels, or sites TrueRate
  integrates with (e.g. Booking.com) — report those to the provider,
- the Azure platform and other managed dependencies — report to the vendor,
- findings that require a compromised device, a malicious browser extension, or
  physical access,
- automated scanner output with no demonstrated, exploitable impact,
- missing best-practice hardening with no concrete attack (e.g. "header X is
  absent") — useful, but please frame it as a hardening suggestion rather than
  an active vulnerability.

## Supported versions

TrueRate is continuously deployed from `main`: every push to `main` redeploys
the live surfaces, and there are no maintained release branches. Only the
latest commit on `main` (and the currently deployed images) receive security
fixes — older commits are not patched.

| Version | Supported |
| --- | --- |
| `main` (latest) | :white_check_mark: |
| anything older | :x: |

## Safe harbor

We consider good-faith security research that respects this policy to be
authorized. We will not pursue legal action against researchers who:

- make a genuine effort to avoid privacy violations, data destruction, and
  service disruption,
- only interact with accounts they own or have explicit permission to test,
- give us a reasonable time to remediate before any public disclosure.

If you're unsure whether a specific test is acceptable, ask first in a private
report.
