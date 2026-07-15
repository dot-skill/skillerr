---
name: changelog-writer
description: >
  Use this skill when drafting a changelog entry for a shipped feature,
  summarizing a pull request for release notes, or turning a raw commit
  log into user-facing prose.
license: MIT
compatibility: Requires read access to the repository's git history.
allowed-tools: Bash Read
metadata:
  author: skillerr-examples
  version: "1.0"
  internal: true
---

# Changelog Writer

Turns raw engineering context (commit messages, PR descriptions, diffs)
into a clear, user-facing changelog entry.

## Voice and tone

Write for the person using the product, not the person who built it. Lead
with the user-visible behavior change, not the implementation. Avoid
internal jargon (ticket numbers, internal service names) unless the
audience is known to be technical.

## Structure

Every entry follows: one-line summary, then (if needed) 1-3 bullet points
of detail. Group multiple related changes under one heading rather than
listing every commit separately.

## Common mistakes to avoid

Do not simply reformat the commit message. Do not include "misc fixes" or
similar non-specific language — either name the fix or omit it. Do not
claim a change fixes something it doesn't; verify against the actual diff
or PR description before writing the entry.

## Example

Input: "fix(auth): handle expired refresh token by forcing re-login instead
of silent 500". Output: "Sessions with an expired refresh token now prompt
you to log in again instead of showing an error."
