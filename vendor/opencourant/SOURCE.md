# OpenCourant in BlownSim

BlownSim's Reference solver runs OpenCourant, the community continuation of
OpenRadioss, unchanged. It is free software under the GNU Affero General
Public License, version 3 or later (LICENSE.md; third-party licences in
`licenses/`; copyright and provenance in COPYRIGHT.md).

The programs shipped with BlownSim are the Windows build from release
`latest-20261011` of https://github.com/OpenCourant/OpenCourant
(`OpenCourant_win64.zip`, SHA-256
6d0ea8b43b68aa12f0a2787b339384a554978cbb65a5d3dbaf1e40598f02e7e6),
built from commit cb760c206e346eff12161a2268b134ef9d48a4ef. The complete
corresponding source is that commit of the repository above. Full Blown /
Studio Vertigo will also provide a copy of that source on request.

BlownSim runs OpenCourant as a separate program (it writes an input file and
reads the results); BlownSim's own code is not part of OpenCourant.

One file is shipped under another name, unchanged: `exec/engine_win64_impi_sp.exe`
is installed as `exec/Simflate Reference engine.exe`, so it is recognisable in
Task Manager.
