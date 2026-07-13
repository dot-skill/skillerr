# Examples

## Copy-paste prompts (start here)

Humans install `skillerr` once, then point their AI at the work. Starter prompts:

→ **[prompts.md](./prompts.md)**

## Fixtures

Sources for compile / pack / extract tests.

| Path | Kind | Notes |
|------|------|-------|
| `knowledge-only/` | Legacy adapter source (`recipe.json`) | Continuity pack fixture |
| `parameterized-integration/` | Legacy adapter source | Continuity pack fixture |
| `code-changing/` | Legacy adapter source | Continuity pack fixture |
| `contract-foundation/` | `SkillSource` / contract (`source.json`) | Release compile fixture |
| `multi-skill-extract/` | Redacted journey (`journey.json`) | `skill extract` / `segment` fixture |

Protocol vocabulary is **section / SkillSource / SkillContract / compile**.
Legacy `recipe.json` fixtures exercise the adapter path only.

What an agent runs for the multi-skill identify path:

```bash
skill agent-guide
skill extract examples/multi-skill-extract/journey.json -o /tmp/skillerr-extract
```
