# RFC NNNN — Title (PROTO-N if applicable)

Status: **Draft, spec only, not implemented** (update once code lands: **Implemented**, with a link to the PR/commit and, if a breaking change, which release shipped it)

## Motivation

What gap does this close? Cite the specific threat, limitation, or missing capability, ideally with a link to where it's tracked (a [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) row, an issue, or a roadmap item). Explain why the current design can't already do this.

## Proposal

The actual design. Be concrete: exact field names, exact types, exact wire shapes. If there are alternatives you considered and rejected, say so briefly and why.

## Schema diff

Exactly what changes in the container format, a schema file, or a TypeScript type. Call out explicitly whether this is additive (new optional field, new enum value) or breaking (removes/renames/narrows something that already ships). Additive is strongly preferred, see [CONTRIBUTING.md](../../CONTRIBUTING.md)'s pull request checklist.

## Migration

What happens to packages/anchors/data that already exist when this ships? "Nothing, this is purely additive" is a valid and good answer. If it's breaking, spell out exactly what stops working and what the fix is.

## Fixtures

What test fixtures does this add or require: adversarial cases, canonicalization vectors, captured real-infrastructure fixtures (like the Rekor anchor fixtures under `fixtures/transparency/`). A second runtime should be able to use these to validate its own implementation, see [CONTRIBUTING.md](../../CONTRIBUTING.md)'s "second independent runtime" section.

## Open questions

Anything genuinely unresolved. Delete this section if there isn't one.
