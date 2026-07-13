/**
 * @skillerr/skill-score is an optionalDependency (see package.json) —
 * it may not be installed, and cli.ts's `score` case dynamic-imports it
 * behind a try/catch for exactly that reason. This ambient declaration
 * lets tsc type-check that dynamic import without requiring the real
 * package (with its real types) to be resolvable at build time.
 */
declare module "@skillerr/skill-score" {
  export function scoreSkill(assessment: unknown, profile: "release" | "continuity"): unknown;
}
