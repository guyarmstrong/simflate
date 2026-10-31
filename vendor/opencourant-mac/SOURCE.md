# OpenCourant in Simflate (Mac)

Simflate's Reference solver runs OpenCourant, the community continuation of
OpenRadioss. It is free software under the GNU Affero General Public License,
version 3 or later (LICENSE.md; copyright and provenance in COPYRIGHT.md).

OpenCourant publishes no Mac version. The Mac programs shipped with Simflate
were built from https://github.com/guyarmstrong/opencourant-mac, branch
`macos`, commit 84a0325579d4158a2e84e1ad63e311dac82abe3a (GitHub Actions run
41218041420, macOS 15, Apple silicon, Homebrew GCC 16.2). That fork is
OpenCourant with the changes needed to build and run on macOS (all listed in
its history); the complete corresponding source is that commit. Full Blown /
Studio Vertigo will also provide a copy of that source on request.

The libraries next to the programs in `exec/` are copied unchanged from
Homebrew (GCC runtime, Boost, METIS, LAPACK / BLAS) under their own licences.

Simflate runs OpenCourant as a separate program (it writes an input file and
reads the results); Simflate's own code is not part of OpenCourant.

Three files are shipped under other names, unchanged: `starter_macosa64_gf_sp`
as `starter_macos_sp`, `engine_macosa64_gf_sp` as `Simflate Reference engine`,
and `anim_to_vtk_macosa64` as `anim_to_vtk_macos`.
