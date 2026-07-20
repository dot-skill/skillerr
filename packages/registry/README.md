# `@skillerr/registry`

Optional **local transparency log** for `.skill` package digests.

Records package digests for auditability. This is not a marketplace, not a hosted registry, and not required to create or run skills. Share `.skill` files directly; use the log when you want a local digest trail.

## Install

```bash
npm i @skillerr/registry
```

CLI:

```bash
skill registry list
skill registry lookup <digest>
skill registry publish <file.skill>
```

## Related

- [`@skillerr/core`](https://www.npmjs.com/package/@skillerr/core) — digests and mint
- [`skillerr`](https://www.npmjs.com/package/skillerr) — `skill registry …`

Docs: [REGISTRY.md](https://github.com/dot-skill/skillerr/blob/main/docs/REGISTRY.md)

## License

Apache-2.0
