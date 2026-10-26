---
description: Start-of-session catch-up — read the handoff, check the build, say where things stand
---

Start a BlownSim session:

1. Read `CLAUDE.md`, `docs/HANDOFF.md` and the newest entry in `docs/BUILD_LOG.md`.
2. `git status`, `git log --oneline -5`, `gh run list -L 3`.
3. With Node 22 + cargo on PATH, run `npm test` (Rust tests + type check). If it fails, fix it before anything else.
4. Tell Guy in two or three plain-English lines: where things stand, anything broken, and what you propose to do next (from the handoff's next steps, unless he's asked for something else).

$ARGUMENTS
