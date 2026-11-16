# Puzzle Foundry

A local-first web app for reproducible interlocking SVG puzzle patterns. It uses TypeScript, Vite, D3 Delaunay/Voronoi, and integer-coordinate Clipper geometry. There is no backend, account, analytics, CDN, or remote geometry service. All runtime assets are bundled; once the local server is running, generation and downloads work without an internet connection.

## Install and run locally

Install **Node.js 22.12+** (including npm), then open a terminal in this folder:

```powershell
cd E:\PuzzleGenerator
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Leave the terminal running; press Ctrl+C to stop. On another operating system, `cd` into your downloaded project folder instead. The first dependency installation requires internet access. Subsequent launches only need `npm run dev`.

For a production build:

```sh
npm run build
npm run preview
```

Open **http://127.0.0.1:4173**. The complete static app is in `dist/`. Serve that directory with any static HTTP server. Double-clicking `index.html` using `file://` is not supported because the app uses ES modules and a geometry worker.

This workspace also contains a locally bootstrapped npm for the Codex environment, which has Node but no `npm` command on PATH. If using that same environment, substitute `node .tools/package/bin/npm-cli.js` for `npm` in these commands. A normal Node.js installation does not need this workaround.

## Host on GitHub Pages

1. Create a GitHub repository and upload/commit the project source, including `package-lock.json` and `.github/workflows/pages.yml`. Exclude `node_modules`, `.tools`, `.npm-cache`, `artifacts`, and `dist` (already covered by `.gitignore`).
2. Push to the `main` branch. If you use another branch, change the workflow's `branches` list.
3. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Run **Build and deploy Puzzle Foundry** from Actions, or push another commit. The workflow tests the geometry, builds `dist`, and deploys it.
5. Open the URL shown by the deployment, normally `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

Relative asset paths support both repository subpaths and custom domains. The published app still calculates locally on each visitor's device. Presets do not sync between devices or between localhost and Pages; export/import JSON to transfer them. No GitHub repository has been created or deployed by this implementation.

The included workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Using the workshop

- **Pattern:** 10–2000 mm width/height, optional aspect lock, quick counts or 1–200 requested pieces, rectangular or Voronoi geometry, seed, distribution, and grid jitter. The aspect lock captures the ratio of the current width and height; editing either updates the other.
- **Rectangular layout:** automatic near-square rows/columns may round a custom count up (17 becomes 4 × 5 = 20). Custom rows/columns take priority over the count request. The actual count is always reported, and the warning explains any difference. Rectangular mode disables point distribution and jitter to preserve the chosen structure.
- **Seam curvature:** 0–20 mm of requested bow, independent of grid jitter and enabled in rectangular, grid Voronoi, and Poisson modes. Zero preserves straight base seams. Seeded bows bend the shared boundaries, including the tab baseline, without moving the grid vertices or outer rectangle. It also works with no tabs. Each bow is limited to the reserved regions on either side of its edge; the actual range is shown below the control. Large tabs and narrow pieces leave less room for bends. Curves are stored as shared vector polylines with a 0.005 mm bow chord tolerance and are included in every SVG export mode, preset, and SVG metadata.
- **Voronoi:** the requested count is exact. Grid uses balanced rows for custom counts and regular rows for square quick counts; zero jitter yields regular seed positions. Jitter ranges from 0–80% of cell spacing (±40% maximum displacement). Poisson uses deterministic minimum-distance rejection sampling, with a smaller radius and restart if needed to place the exact count. Jitter and row/column controls do not apply to Poisson/Voronoi layouts, respectively.
- **Tabs and fit:** classic rounded jigsaw tabs, rectangular keyed heads, triangular arrowheads, or no tabs. Jigsaw tabs have rounded bulbs, narrow necks, and smooth shoulders; their curves are exported as vector polylines with a 0.005 mm chord tolerance. Depth is in millimeters; rectangular keyed heads are twice as wide as their depth. A depth is chosen once per shared edge and used by both neighbors. Random depth uses the same seed and stays within the selected range. Depths are capped by local space; if a random minimum cannot fit, generation fails with an explanation.
- **Clearance:** a geometric channel of the chosen total width is removed along internal seams. Each mating piece gives up half that width. The input supports 0–3 mm in 0.01 mm steps. If the requested gap would destroy small pieces or tabs, the app searches for a smaller valid gap, rounds down to 0.01 mm, updates the control, and reports the adjustment. Exports and presets use that actual value. Super tight, Tight, and Loose buttons suggest starting gaps scaled to piece spacing; verify them with a test print. Clearance affects piece outlines, including sockets, while keeping the exterior on the original rectangular boundary. There is no clearance on the outer border. At corners and junctions the channel uses miter joins (limit 2) and square caps; the stated clearance is the perpendicular gap along seam segments, not a promise of the same distance in every direction at a corner.
- **SVG line thickness:** changes the displayed/exported stroke width only. It does not change the shape coordinates or set Bambu Studio's physical cut width. Exported dimensions refer to geometric boundaries; visible strokes are centered on those boundaries.
- **Numeric controls:** every numeric setting has a slider below its input and an individual ↺ reset button inside the input. Tab-depth sliders use geometry-derived maxima, updated after generation: depth/maximum use the largest available seam, while random minimum uses the depth that fits every seam. The panel reports both limits; typed requests beyond available space are capped per seam. Disabled settings also disable their sliders and resets. Aspect lock still applies when resetting width or height.
- **Preview:** scroll to zoom around the pointer, drag to pan, use +/− and Fit, or focus the canvas and press 0 to fit. Touch users can drag and use the zoom buttons. Turning Colors off shows white pieces with black cut lines and black piece numbers in both preview modes. Colors and numbers are independent of export decorations. The two preview modes show nominal single seams or individual closed profiles with clearance.
- **Presets:** save, load, rename, update, duplicate, delete, import, and export. All generation, preview, and export settings are preserved. Presets and the last successful settings use localStorage. Imports are validated and appended as new copies, without replacing existing presets. Storage is limited to 100 presets; JSON files to 2 MB. Clearing browser storage removes local presets.

## SVG export modes

| Mode | Geometry | Clearance | Intended use |
| --- | --- | --- | --- |
| Cutting mask | One compound filled path containing only the gaps, with holes for kept pieces; no background or stroke | Applied | Bambu Studio Cut / negative part, or CAD subtraction |
| Cut lines | One closed outer boundary and each internal boundary once, as an open path | Not applied | Sketch/CAM centerlines; derive explicit cutter solids in CAD |
| Piece outlines | One closed, white filled path per piece with black lines, in assembled coordinates | Applied | Import closed profiles into CAD and extrude/intersect |

Exports use explicit `width="…mm"`, `height="…mm"`, and a matching `viewBox`. IDs are predictable: `boundary`, `edge-0001`, `piece-001`, etc. Metadata records units, generator geometry version, seed, complete settings, actual count, and actual depth range. Filenames include dimensions, seed, requested tab depth (or random depth range / no-tabs), actual fit clearance, and mode; for example `puzzle-200x160mm-foundry-2026-tab-4mm-fit-0.2mm-piece-outlines.svg`. Local depth caps are recorded in metadata. No raster images or external assets are included.

Colors and numbers are excluded by default. Enabling them explicitly adds decoration; leave them disabled for CAD. In a cut-line export with colors enabled, the additional `decoration-colors` group is artwork and must not be treated as extra cuts. Number labels are SVG text and are not guaranteed to import as CAD geometry without conversion to paths.

Monochrome piece outlines have white fills and black strokes. Monochrome cut-line SVGs use a white fill on the existing outer boundary, followed by black internal seams; this adds no extra cut paths. White filled paths still represent closed areas for CAD extrusion.

Enable **Use custom fit suggestions** to edit Super tight, Tight, and Loose gaps individually. These values are used exactly, without size scaling, and are saved with presets and the last successful settings. The main clearance field also accepts any custom value from 0–3 mm. Disable **Automatically reduce unsafe clearance** to require the exact entered gap. If it is invalid, export is disabled, affected draft cells and the relevant control turn red, and the message explains the failure. Draft highlights never appear in SVG downloads. The last valid geometry remains in memory and returns while new settings are generated. Invalid numeric inputs that cannot define geometry show an error without inventing affected cells.

## Bambu Studio and dividing an existing model

**Verified documentation/source workflow, November 12, 2026:** Bambu's [official import manual](https://csm.bblcdn.com/hub/4668d0ca43994ff3bff4b37f1a65c2e7.pdf) lists SVG in File → Import. The [Bambu Studio SVG tool source](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/Gizmos/GLGizmoSVG.cpp) exposes extrusion depth. Direct SVG import therefore creates SVG-shaped geometry; it does not automatically partition an existing mesh using the exported seam network. Always verify X/Y scale after import. Do not assume an open stroked path will become a cutter of the displayed stroke width.

For a **Bambu Studio Cut / negative part**, select **Cutting mask · Bambu negative cutter** under Export and download a new SVG. Replace the previous SVG cutter with this mask, align it with the model at 1:1 millimeter scale, and position its extrusion through the full model height. Slice and inspect the gaps. The mask fills only material to remove; the pieces are holes. Changing black/white alone does not invert filled geometry. This uses the [SVG tool's Cut / negative-volume operation](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/Gizmos/GLGizmoSVG.cpp). Negative volumes act during slicing; this does not promise separately exportable model solids.

The mask is the rectangular canvas minus the union of the actual clearance-adjusted pieces. Its compound path uses `fill-rule="evenodd"` to preserve holes, supported by [Bambu Studio's SVG fill parser](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/NSVGUtils.cpp). It omits all strokes, backgrounds, labels, and colors so those cannot become accidental cutters. Clearance must be positive and there must be at least two pieces. Red in the Cutting mask preview means material removed; preview colors are not included in the mask. Filled bounds can be narrower than the canvas for single-row/column patterns: retain original units and align origins rather than stretching the filled bounds to match overall dimensions. Geometric subtraction and SVG hole behavior have been tested; Bambu Studio itself has not been run here.

For separately exportable solids, use the **Piece outlines** export as profiles to keep, then extrude and intersect them with copies of the model in CAD. Subtracting these profiles instead would remove the puzzle pieces and leave the gaps. A practical FreeCAD route is:

1. Import the SVG with **SVG as geometry**, retaining all pieces at their common origin. Measure the overall width/height against the requested millimeters before continuing.
2. Convert each closed wire to a face if needed, then use **Part → Extrude** with solid creation enabled. Extrude each profile through the full height of the aligned model, extending beyond both its top and bottom.
3. For each profile solid, select it and a copy of the model solid, then use **Part → Boolean → Common**. This intersects that piece's prism with the model. An STL is a mesh, so it must be converted to a suitable closed solid first, or processed using mesh boolean tools instead. Keep the original model for each operation.
4. Export each resulting solid as STL or together as 3MF where supported. Import into Bambu Studio, check dimensions, and arrange for printing.

This route is based on FreeCAD's own [SVG import/face/extrusion tutorial](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Import_text_and_geometry_from_Inkscape.md), [Part Extrude documentation](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Part_Extrude.md), and [Part Common documentation](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Part_Common.md). Menu placement can vary by version. A full CAD conversion/Bambu Studio print has **not** been executed here; the app's geometry and SVGs have been tested. The resulting split is a straight extrusion through the model, not a surface-following cut.

Cut-line SVGs can instead be used as CAD sketches, but create explicit closed cutting channels before subtraction. A negative-part operation is not a substitute for separate model solids when you need separately exportable puzzle pieces.

## Geometry approach and limitations

1. Clip D3 Voronoi cells to the requested rectangle, or construct exact row/column rectangles. All coordinates are quantized to 0.00001 mm for shared topology and integer operations.
2. When tabs are enabled, merge short Voronoi seams at shared vertices where this keeps all affected polygons simple and star-shaped. This slightly adjusts the exact Voronoi boundaries near those vertices, while preserving the seed sites' piece count. Cleanup is reported. With no tabs, raw clipped Voronoi boundaries are retained.
3. Register each shared edge once. Choose its direction, tab polarity, and depth deterministically; neighbors traverse the same polyline in reverse. Exterior edges remain straight.
4. Confine tab envelopes to reserved triangles between each edge and the cell's interior center, with a 6% reserve. The envelope follows the selected tab profile; rounded tabs use the convex hull containing their Bézier control points. This replaces the former blanket 16%-of-seam cap, permitting larger tabs without overlapping adjacent features or extending outside the boundary. Reserve a minimum material allowance of 0.5 mm for neck/head dimensions after clearance.
5. Build closed profiles, subtract Clipper-offset seam channels for fit clearance, and reject profiles that split, disappear, self-intersect, exceed the boundary, or lose over half their area. Verify nominal coverage and area conservation for the full partition.

Not every combination is physically possible. Very narrow boundaries, many small pieces, high random minimum depths, and large clearance may fail. The last valid preview is preserved and export is disabled until settings become valid. Tabs are deliberately conservative and may be smaller than requested; actual depths are displayed. A piece smaller than 1 mm² is rejected. The 0.5 mm material allowance is a geometric guard, not a guarantee of strength for every printer/material. Print a fit sample before committing to a large model.

Geometric reproducibility is guaranteed for the same settings and geometry version; runtime timing is not included in SVG metadata. Changes in future geometry algorithms or dependency versions may change the pattern, so retain exported SVGs for manufacturing records.

## Validation

```sh
npm test
npm run build
npm run test:browser
```

Geometry tests verify seeded reproduction, reversed shared-edge profiles, closed/simple polygons, absence of area overlap, exact physical dimensions, one cut path per internal edge, an exact measured clearance example, random depth bounds, layout/count handling, preset round trips, starter presets, and a 120-layout seeded sweep. Invalid combinations must report a known physical limitation.

Browser tests run against installed Google Chrome and cover downloads/XML validity, preview controls, error recovery and preserved previews, responsive layout, aspect lock, row/column layouts, both export modes, preset editing/import/export, persistence after page refresh, and regeneration while offline. Install Chrome or set the Playwright `channel` option in `playwright.config.ts` for your browser. Generated screenshots are in `artifacts/` and failure screenshots in `test-results/`. Set `PUZZLE_TEST_URL` to test an already running production server, including a repository subpath.

## Files

- `src/geometry.ts` — topology, deterministic sites/tabs, clearance, validation.
- `src/geometry.worker.ts` — geometry off the main thread.
- `src/main.ts` / `src/style.css` — controls, SVG preview, presets UI, downloads.
- `src/settings.ts` / `src/presets.ts` — settings validation and versioned storage.
- `src/svg.ts` — standalone millimeter SVG serialization.
- `.github/workflows/pages.yml` — test/build/deploy workflow.

Third-party geometry dependencies: [D3 Delaunay (ISC)](https://github.com/d3/d3-delaunay) and [ClipperLib (Boost Software License)](https://github.com/junmer/clipper-lib).
