# anti-slop provenance

- upstream: https://github.com/dmmulroy/anti-slop
- commit: c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b
- upstream date: 2026-09-10
- copied: `src/` to `tools/oxlint/anti-slop/`
- license: MIT (Dillon Mulroy), copied as `LICENSE`

Local change: `rules/no-module-mocking.ts` also rejects Bun `mock.module`
from `bun:test`. Upstream only covers Vitest and Jest.
