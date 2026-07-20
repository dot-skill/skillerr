# `@skillerr/cli`

CLI implementation for the [Open `.skill` Protocol](https://github.com/dot-skill/skillerr).

**Public install:** [`skillerr`](https://www.npmjs.com/package/skillerr) · **Bin:** `skill`

Users install `skillerr` (depends on this package). This package is the internal implementation.

## Install (public)

```bash
npm i -g skillerr
```

Node ≥ 20. Set `SKILL_HOST` when creating (`cursor`, `ollama`, `claude`, …).

## Quickstart

### Create

```bash
export SKILL_HOST=cursor
skill init --title "Demo"
skill journey --summary "Redacted human+AI work; secrets as refs."
skill propose --json '[{"title":"Tone","body":"Keep answers short.","type":"decision"}]'
skill status
skill checkpoint
skill compile -m "Demo" --approve --mint
```

### Ingest / run

```bash
skill inspect ./file.skill
skill validate ./file.skill
skill verify-trust ./file.skill
skill load ./file.skill
skill run ./file.skill
```

### Multi-skill identify

```bash
skill agent-guide
skill extract ./journey.json -o ./extraction   # or: skill segment …
# one workspace per selected candidate → contract-check → compile
```

```bash
skill --help
```

## Related

- [`skillerr`](https://www.npmjs.com/package/skillerr) — public install
- [`@skillerr/protocol`](https://www.npmjs.com/package/@skillerr/protocol)
- [`@skillerr/core`](https://www.npmjs.com/package/@skillerr/core)
- [`@skillerr/runtime`](https://www.npmjs.com/package/@skillerr/runtime)
- [`@skillerr/workspace`](https://www.npmjs.com/package/@skillerr/workspace)

Docs: [Agent](https://github.com/dot-skill/skillerr/blob/main/docs/AGENT.md) · [Protocol](https://github.com/dot-skill/skillerr/blob/main/docs/PROTOCOL.md)

## License

Apache-2.0
