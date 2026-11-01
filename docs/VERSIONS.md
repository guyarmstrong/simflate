# Simflate versions

The version is set in one place: `version` in `package.json` (x.y.z). The
installers read it from there (`tauri.conf.json` points at it); the app shows
it as **v x.yz** — major . minor patch — on the start-up screen, in the top
bar's tooltip and in crash reports. `src-tauri/Cargo.toml` carries the same
number.

A release is a git tag `v` + the version (`v1.0.0`). Pushing the tag builds the
Windows and Mac installers on GitHub and attaches them to a draft release
(private until published; GitHub → Releases).

To make a new version: change `package.json` (and `src-tauri/Cargo.toml`), add
a line below, commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

| Version | Shown as | Date | What |
|---|---|---|---|
| 1.0.0 | Simflate v1.00 | 2026-10-26 | First Simflate release (was BlownSim v2): round mode with Fold over, splash screen, crash reports, new icon. |
| 1.1.0 | Simflate v1.10 | 2026-10-26 | Export outline (DXF / SVG), Ctrl+C to Illustrator, Pebble / star tool, reproducible re-runs; nine example forms on a fresh install; snapshots from older versions get their smooth mesh back; Mac app ad-hoc signed. |
| 1.1.1 | Simflate v1.11 | 2026-10-26 | Short screens: Draft and Inflate tool columns shrink, then go two side by side, before scrolling; Contact view moved beside the Plates eye; plates, their eye and Contact hidden for solvers without plates (Specified geometric, Reference, Symmetric). DWG import (desktop). |
| 1.1.2 | Simflate v1.12 | 2026-10-31 | Reference and Symmetric on Apple-silicon Macs (our OpenCourant Mac build, same results as Windows); Mac icon without the black tile; Mac clipboard (Illustrator paste); Height view from the seam; Seam stiffness default 50, Edge ripples default 0. |

| 1.1.3 | Simflate v1.13 | 2026-11-02 | Mac only: Reference and Symmetric on Intel Macs (universal engine, Mac build 4e4233a); starter fix for an unset count; one engine thread on Intel Macs and on small models. Windows engine unchanged. |