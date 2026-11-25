# MeowTrace Bridge (Photoshop UXP plugin)

Phase 2 of the Adobe integration: a small panel that pulls your latest
**Send to Photoshop** from the MeowTrace app and opens it straight away,
layers included. Without it, *Send to Photoshop* still works: MeowTrace writes a layered PSD and opens it in the newest Photoshop it can find.

## Use it

1. In MeowTrace, open **Settings → Adobe live bridge** and turn on **Enable bridge**.
   The default port is 47811, and the bridge listens on `127.0.0.1` only.
2. Load this folder in **Adobe UXP Developer Tool**: *Add Plugin → select
   `manifest.json` → Load*.
3. In Photoshop, open **Plugins → MeowTrace**. Keep the panel open; each new send opens automatically.

The bridge serves two endpoints: `GET /latest`, which returns the newest send's metadata as JSON, and `GET /file/<id>`, which returns the file itself. Any tool can use them.

> Status: experimental. The panel targets the UXP manifest v5 APIs (Photoshop 2023+). It has not been tested inside Photoshop yet. Illustrator's UXP support is still limited, so Illustrator uses the file-based send (SVG with named layer groups).
