# RFCs

Spec-level proposals for gaps identified in the [threat model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) that aren't closed by code yet, plus the ones that have since shipped. RFCs live here, in-repo, so they go through the same pull-request review as any other change (not the wiki, which bypasses that). See [CONTRIBUTING.md](../../CONTRIBUTING.md) "Spec changes (RFCs)" for how to propose a new one, and [0000-template.md](./0000-template.md) for the shape to use.

| RFC | Title | Status |
|---|---|---|
| [0001](./0001-asymmetric-signatures-trust-store.md) | Real asymmetric signatures + trust store | **Implemented**, see [Key Ceremony](../KEY-CEREMONY.md) for the operational walkthrough |
| [0002](./0002-human-review-countersignature.md) | Separate human-review countersignature | Draft, spec only |
| [0003](./0003-revocation-expiry.md) | Revocation + expiry | Draft, spec only |
| [0004](./0004-dangling-step-kinds.md) | Specify or reserve dangling step kinds (`subskill`, `delegate`) | Draft, spec only |
| [0005](./0005-media-type-magic-identification.md) | Media type + magic identification | Draft, spec only |
| [0006](./0006-lineage-chain.md) | Lineage chain | Draft, spec only |
| [0007](./0007-subject-bearing-transparency-anchor.md) | Subject-bearing transparency anchor | **Implemented** |
