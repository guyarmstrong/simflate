# SketchUp SDK — the one manual download

Writing a native `.skp` file needs Trimble's **SketchUp C SDK**. It's free, but
Trimble asks you to sign in and accept their terms, so it can't be downloaded
automatically.

## Steps (about 5 minutes)

1. Go to the SketchUp developer site (search "SketchUp C API SDK download",
   it's on `developer.sketchup.com`) and sign in with a Trimble ID (free).
2. Read the SDK terms. The question to check: **may we bundle the SDK's runtime
   library (`SketchUpAPI.dll` on Windows, a framework on Mac) inside our own
   in-house app?** For an in-house tool that is very likely fine.
3. Download the **Windows** SDK (and the Mac one if you'll build for Mac).
4. Unzip it into this project at:

   ```
   vendor/sketchup-sdk/
   ```

   so that you have e.g. `vendor/sketchup-sdk/headers/` and
   `vendor/sketchup-sdk/binaries/`.
5. Tell Claude "the SketchUp SDK is in place". Claude will write a test cube in
   SketchUp 2020 format and show you how to open it.

`vendor/sketchup-sdk/` is excluded from git, so Trimble's files are never
uploaded anywhere.

## If the terms don't allow it

BlownSim falls back to **Collada (.dae)**, which SketchUp 2020+ imports
natively. You lose soft/smooth edge flags and nested groups, but the shape is
identical.
