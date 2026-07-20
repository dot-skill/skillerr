# `@skillerr/workspace`

Local working tree for authoring `.skill` packages — sections, stage, compile, checkpoint, and mint.

Git-like layout under `.skill/`. Agents propose sections; humans stage and approve; compile produces a continuity draft or a release package.

## Install

```bash
npm i @skillerr/workspace
```

Typically used via [`skillerr`](https://www.npmjs.com/package/skillerr) (`skill init`, `propose`, `checkpoint`, `compile`, `load`).

## Layout

```text
.skill/
  config.json
  sections/*.json
  index.json          # staged ids
  HEAD.json
  objects/*.skill
```

| Concept | Command (CLI) |
|---------|----------------|
| init | `skill init` |
| propose | `skill propose` (agent + `SKILL_HOST`) |
| stage | `skill add` |
| status | `skill status` |
| handoff | `skill checkpoint` |
| release | `skill compile --approve --mint` |
| resume | `skill load` |

## Related

- [`@skillerr/core`](https://www.npmjs.com/package/@skillerr/core) — compile / mint
- [`skillerr`](https://www.npmjs.com/package/skillerr) — public install / user-facing CLI

Docs: [WORKSPACE.md](https://github.com/dot-skill/skillerr/blob/main/docs/WORKSPACE.md) · [CONTINUITY.md](https://github.com/dot-skill/skillerr/blob/main/docs/CONTINUITY.md)

## License

Apache-2.0
