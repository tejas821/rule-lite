# Security

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | ✅ |
| 1.x | ✅ (condition-evaluation core only; upgrade to 2.x recommended) |

## Dependency footprint

`rule-lite` ships with **zero runtime dependencies** — `npm install rule-lite` pulls in nothing beyond the package itself. There is no transitive dependency tree for a CVE to hide in on the consumer side. Development-only tooling (`jest`, `tsup`, `typescript`) is never published (`files: ["dist"]` in `package.json`) and never reaches anyone who installs the package.

The expression and condition engines are also deliberately **not** built on `eval`/`new Function` — every rule and value expression is a plain, walked JSON tree, evaluated by looking functions up in a fixed, whitelisted registry. This is a design constraint, not just a convenience: it means a malicious or malformed rule config cannot execute arbitrary code, even if that config came from an untrusted source (e.g. an admin UI where non-developers author rules).

## Automated scanning

This repository runs two independent scans on every push, every pull request, and weekly regardless of code changes (`.github/workflows/security.yml`):

- **`npm audit --audit-level=high`** — checks the dependency tree (dev tooling only, per above) against the npm/GitHub advisory database and fails CI on any high or critical finding.
- **CodeQL** (GitHub's static analysis engine) — scans the actual TypeScript source for known vulnerability patterns (injection, unsafe regex, prototype pollution, etc.) on every change.

Both are visible as status checks on every commit and pull request, and as the badges at the top of the README.

### Current status (as of the last local check before publishing)

- Runtime dependencies: **0**
- Dev-toolchain `npm audit`: **0 high/critical** advisories (1 low-severity, Windows-only, dev-server-only advisory in a transitive build tool remains open — it affects `esbuild`'s local dev server, is never invoked by this package's build or test scripts, and never ships; tracked for resolution on the next `tsup` major upgrade)

This statement reflects a point-in-time scan, not a standing guarantee — see the live badges in the README for the current automated result, since the advisory database changes over time independent of this code.

## Reporting a vulnerability

Please use [GitHub's private security advisory form](https://github.com/tejas821/rule-lite/security/advisories/new) for this repository rather than opening a public issue. If you don't have GitHub access, you can also reach the maintainer directly at the email on the npm package page.

Please include a minimal reproduction where possible. We aim to acknowledge reports within a few days.
