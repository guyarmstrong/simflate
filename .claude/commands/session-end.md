---
description: End-of-session housekeeping — checks, build log, handoff, commit, push
---

Run the BlownSim end-of-session routine (see CLAUDE.md → Session routine). Do all of it without asking, then report briefly in plain English.

1. Use Node 22 + cargo on PATH (see CLAUDE.md → Machine quirks). Run `npm run housekeeping`. Fix anything marked ✖. Delete experiment leftovers in `runs/` unless they're needed next session (say which you kept).
2. Append a dated entry to the top of `docs/BUILD_LOG.md`: what Guy asked for, what was built, what changed underneath, how it was checked. Use `git log` since the last entry to make sure nothing is missed.
3. Rewrite `docs/HANDOFF.md` so it is true *now*: state of each area, how to resume, prioritised next steps, open questions for Guy, known issues. Remove anything stale.
4. Add new technical decisions to `docs/DECISIONS.md`. If anything visible changed, update `HOW_TO_TEST.md`.
5. Commit ("Session N wrap-up: …") and push. Pushes no longer start installer builds (saves Actions minutes) — only start one (`gh workflow run build.yml --ref v2-thickness`) if Guy asked for an installer, then check `gh run list -L 2`.
6. Update Claude memory if something non-obvious was learned (not things the docs now record).
7. Tell Guy in a few lines: what's done, what to try, what's next, and that it's safe to compact or close.

$ARGUMENTS
