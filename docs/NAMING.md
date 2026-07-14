# Naming

Five different strings show up across this codebase, npm, and GitHub, and they mean five different things. None of them are interchangeable, and none of them are going away — this doc just says what each one actually is.

| String | What it is |
|---|---|
| **Open `.skill` Protocol** | The project/spec identity — what this whole thing *is*. Used in titles: repo descriptions, site title, README headings. Not a company name, not a product brand. |
| **`.skill`** | The file format and extension. The thing a user downloads, inspects, mints, and runs. |
| **`dot-skill`** | The GitHub organization (`github.com/dot-skill`) and the frozen wire identifiers: manifest `kind: "dot-skill"`, media types `application/vnd.dot-skill+zip` and `application/vnd.dot-skill-manifest+json`. Predates the protocol-first framing — kept exactly as-is for compatibility. **Never changed by a rebrand**: any package that has ever read a `.skill` file checks for `kind: "dot-skill"`, and that check must keep working forever. |
| **`@skillerr/*`** | The npm scope for the reference implementation packages (`@skillerr/protocol`, `@skillerr/core`, `@skillerr/runtime`, `@skillerr/workspace`, `@skillerr/registry`, `@skillerr/cli`). One implementation of the protocol, not the protocol itself — an independent Go or Rust implementation would carry its own package name, not this scope. |
| **`skillerr`** | The public npm package (`npm i -g skillerr`) and its CLI bins (`skill`, `skillerr`). This is the name people type, not a brand identity — see [ROADMAP.md](./ROADMAP.md) and the site for why titles lead with "Open `.skill` Protocol" instead. |

## Why this split exists

The project started under the `dot-skill` name before the protocol-first framing was adopted (see the site and README history). Renaming the wire identifiers or the GitHub org at this point would break every `.skill` file and every integration that already checks `kind: "dot-skill"` — so those stay frozen. What *did* change is which name leads in prose: titles, headings, and pitch copy now say "Open `.skill` Protocol," and "Skillerr"/`skillerr` is scoped down to meaning the package and CLI, not the project's identity.

If you're writing docs or copy: lead with **Open `.skill` Protocol** when describing what this is. Use `skillerr` only when you mean the literal install command, package, or binary. Never use "Skillerr" as a proper-noun subject ("Skillerr does X") — say "the protocol does X" or "`skillerr` (the CLI) does X" instead.

## What this doc does not cover

This is a naming reference, not a rebrand. It does not change:
- The manifest `kind` field, media types, or file extension
- The `dot-skill` GitHub org name
- Any published package name or npm scope
- Existing `.skill` files — they remain valid exactly as minted
