# `@skillerr/protocol`

Types, schemas, and completeness rules for the [Open `.skill` Protocol](https://github.com/dot-skill/skillerr).

Defines **SkillContract**, **SkillSource**, section shapes, assessment helpers, and the JSON Schema used for transferable authoring. This package is the semantic source of truth; it does not pack or run skills.

## Install

```bash
npm i @skillerr/protocol
```

## What you get

- `SkillContract` / `SkillSource` TypeScript types
- Completeness assessment and explanation APIs
- Multi-skill extract helpers (`extractSkillCandidates`, `agentCreateGuide`)
- `skill-contract.schema.json` (JSON Schema export)
- Adapter types for external capture formats (mapped into SkillSource before compile)

## Vocabulary

Protocol terms: **section**, **SkillSource**, **SkillContract**, **extract/segment**, **compile**, **mint**, **load**.

Product-specific capture words map into this model via adapters; they are not protocol vocabulary.

## Related

- [`@skillerr/core`](https://www.npmjs.com/package/@skillerr/core) — compile / pack / mint
- [`skillerr`](https://www.npmjs.com/package/skillerr) — public install (`skill` CLI)

Docs: [PROTOCOL.md](https://github.com/dot-skill/skillerr/blob/main/docs/PROTOCOL.md) · [AUTHORING-CONTRACT.md](https://github.com/dot-skill/skillerr/blob/main/docs/AUTHORING-CONTRACT.md)

## License

Apache-2.0
