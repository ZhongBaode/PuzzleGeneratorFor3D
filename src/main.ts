import './style.css';
import './numeric.css';
import { defaults, layout, validateSettings, type Settings } from './settings';
import { type Pattern, type Diagnostic } from './geometry';
import { cuttingMask, cuttingMaskError, escapeXml, exportSvg, palette, pathData, svgFilename } from './svg';
import { parsePresets, readPresets, writePresets, type Preset } from './presets';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const icon = (name: string) => {
  const paths: Record<string, string> = {
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    shuffle: '<path d="M3 7h4l10 10h4m-4-4 4 4-4 4M3 17h4l4-4m2-2 4-4h4m-4-4 4 4-4 4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1-1.5 3m0 3h.01"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.plus}</svg>`;
};
const number = (key: keyof Settings, label: string, min: number, max: number, step = 1, unit = '') => `<div class="field numeric-field"><label for="${key}">${label}${unit ? `<small>${unit}</small>` : ''}</label><div class="numeric-input"><input data-setting="${key}" id="${key}" type="number" min="${min}" max="${max}" step="${step}" /><button type="button" data-reset="${key}" aria-label="Reset ${label} to default" title="Reset to ${defaults[key]}${unit ? ` ${unit}` : ''}">↺</button></div><input data-slider="${key}" type="range" min="${min}" max="${max}" step="${step}" aria-label="${label} slider" /></div>`;
const toggle = (key: keyof Settings, label: string) => `<label class="toggle"><span>${label}</span><input data-setting="${key}" id="${key}" type="checkbox" /><span class="switch" aria-hidden="true"></span></label>`;
const select = (key: keyof Settings, label: string, options: [string, string][]) => `<label class="field"><span>${label}</span><select data-setting="${key}" id="${key}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;

$('#app').innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="Puzzle Foundry home"><span class="brand-mark"><svg viewBox="0 0 32 32" fill="none"><path d="M5 5h8v4h6V5h8v8h-4v6h4v8h-8v-4h-6v4H5v-8h4v-6H5z" stroke="currentColor" stroke-width="2"/></svg></span><span>Puzzle Foundry<small>THE SVG PATTERN WORKSHOP</small></span></a>
    <div class="header-actions"><button id="image-workshop" class="secondary" aria-label="Open image to 3D puzzle workshop">Image → 3D<span class="image-entry-detail"> puzzle</span></button><span class="local-badge"><i></i> Runs on your device</span><button id="guide" class="icon-button" title="Setup and Bambu Studio guide" aria-label="Open usage guide">${icon('help')}</button><button id="download" class="primary" disabled>${icon('download')}<span>Download SVG</span></button></div>
  </header>
  <main class="workspace">
    <aside class="settings-panel" aria-label="Puzzle settings">
      <div class="panel-intro"><span class="eyebrow">MAKE IT FIT</span><h1>A pattern of your own.</h1><p>From a blank canvas to interlocking pieces.<br>Every measurement, in millimeters.</p></div>
      <details open class="section"><summary><span class="section-index">01</span> Pattern <span class="chevron">⌄</span></summary><div class="section-body">
        <div class="two-col">${number('width', 'Width', 10, 2000, 0.1, 'mm')}${number('height', 'Height', 10, 2000, 0.1, 'mm')}</div>
        ${toggle('aspectLock', 'Lock aspect ratio')}
        ${select('sizingMode', 'Choose pieces by', [['count', 'Piece count'], ['size', 'Target piece size']])}
        ${number('pieceSize', 'Target piece side', 1, 2000, 0.5, 'mm')}
        <p class="hint" id="piece-size-hint"></p>
        <div class="field"><span>Piece count <small>requested</small></span><div class="count-chips">${[4, 9, 16, 25, 36, 49, 64, 100].map(n => `<button type="button" data-count="${n}">${n}</button>`).join('')}</div></div>
        ${number('count', 'Custom count', 1, 200)}
        ${select('geometry', 'Piece geometry', [['rectangular', 'Rectangular'], ['voronoi', 'Voronoi']])}
        ${select('gridMode', 'Row & column layout', [['auto', 'Automatic · near-square'], ['manual', 'Custom rows & columns']])}
        <div class="two-col">${number('rows', 'Rows', 1, 30)}${number('columns', 'Columns', 1, 30)}</div>
        <p class="hint" id="grid-hint"></p>
        ${select('distribution', 'Point distribution', [['grid', 'Grid'], ['poisson', 'Poisson disk']])}
        <p class="hint" id="distribution-hint"></p>
        ${toggle('jitterEnabled', 'Enable grid jitter')}
        ${number('jitter', 'Grid jitter', 0, 0.8, 0.01)}
        <p class="hint" id="jitter-hint"></p>
        ${toggle('curvatureEnabled', 'Enable seam curvature')}
        ${number('seamCurvature', 'Seam curvature', 0, 20, 0.1, 'mm')}
        <p class="hint" id="curvature-description">Bends internal seams independently of grid jitter, including rectangular and Poisson patterns. 0 keeps straight seams. Bends are seeded and limited to available space; the outer border stays straight.</p>
        <p class="hint" id="curve-hint"></p>
        <label class="field"><span>Random seed <small>repeatable by design</small></span><div class="input-action"><input id="seed" data-setting="seed" type="text" maxlength="120" spellcheck="false" /><button id="new-seed" title="New seed" aria-label="New seed">${icon('shuffle')}</button></div></label>
      </div></details>
      <details open class="section"><summary><span class="section-index">02</span> Tabs & fit <span class="chevron">⌄</span></summary><div class="section-body">
        ${select('tabStyle', 'Tab style', [['jigsaw', 'Jigsaw · rounded'], ['rectangular', 'Rectangular · keyed'], ['triangular', 'Triangular · arrowhead'], ['none', 'None · no tabs']])}
        ${number('tabSize', 'Tab depth', 0.5, 100, 0.1, 'mm')}
        ${toggle('randomTabs', 'Random tab sizes')}
        <div class="two-col" id="random-range">${number('tabMin', 'Minimum depth', 0.5, 100, 0.1, 'mm')}${number('tabMax', 'Maximum depth', 0.5, 100, 0.1, 'mm')}</div>
        <p class="hint" id="tab-hint">Tabs are sized to fit their seam. Outer edges stay straight.</p>
        <p class="hint" id="tab-limit-hint"></p>
        ${number('clearance', 'Fit clearance / tab margin', 0, 3, 0.01, 'mm')}
        ${toggle('autoClearance', 'Automatically reduce unsafe clearance')}
        ${toggle('customFits', 'Use custom fit suggestions')}
        <div id="custom-fit-values" class="custom-fit-values">
          ${number('fitSuperTight', 'Super tight gap', 0, 3, 0.01, 'mm')}
          ${number('fitTight', 'Tight gap', 0, 3, 0.01, 'mm')}
          ${number('fitLoose', 'Loose gap', 0, 3, 0.01, 'mm')}
        </div>
        <div class="fit-suggestions" aria-label="Suggested fits"><button data-fit="0.05">Super tight <small></small></button><button data-fit="0.15">Tight <small></small></button><button data-fit="0.3">Loose <small></small></button></div>
        <p class="hint" id="fit-hint"></p>
        <div class="note"><b>A real gap, not a thicker line.</b><p>Clearance is the total gap between mating pieces: half is removed from each side. It affects piece outlines only. Outer edges stay on the canvas boundary.</p></div>
      </div></details>
      <details open class="section"><summary><span class="section-index">03</span> Export <span class="chevron">⌄</span></summary><div class="section-body">
        ${select('exportMode', 'SVG geometry', [['mask', 'Cutting mask · Bambu negative cutter'], ['pieces', 'Piece outlines · shapes to keep'], ['cut', 'Cut lines · single shared seams']])}
        <p class="hint" id="export-hint"></p>
        ${number('strokeWidth', 'SVG line thickness', 0.01, 3, 0.01, 'mm')}
        <p class="hint">Stroke width changes appearance in preview and SVG. It does not define a physical cut width in Bambu Studio.</p>
        ${toggle('exportColors', 'Include piece colors in SVG')}
        ${toggle('exportLabels', 'Include piece numbers in SVG')}
        <p class="hint">Colors and numbers are preview-only until enabled here. SVG text labels use the viewer’s font.</p>
        <button id="guide-link" class="text-button">How to use this with a 3D model ↗</button>
      </div></details>
      <details open class="section"><summary><span class="section-index">04</span> Presets <span class="chevron">⌄</span></summary><div class="section-body">
        <label class="field"><span>Saved on this browser</span><select id="preset-select" aria-label="Saved preset"></select></label>
        <div class="two-col"><button id="load-preset" class="secondary">Load preset</button><button id="update-preset" class="secondary">Update settings</button></div>
        <label class="field"><span>Preset name</span><input id="preset-name" type="text" maxlength="100" placeholder="e.g. My first puzzle" /></label>
        <button id="save-preset" class="secondary full">＋ Save current as new preset</button>
        <div class="three-col"><button id="rename-preset" class="quiet">Rename</button><button id="duplicate-preset" class="quiet">Duplicate</button><button id="delete-preset" class="quiet danger">Delete</button></div>
        <div class="preset-files"><button id="import-presets" class="text-button">Import JSON</button><span>·</span><button id="export-presets" class="text-button">Export JSON</button></div>
        <input id="preset-file" type="file" accept="application/json,.json" hidden />
        <p class="hint" id="preset-message" role="status">All generation, preview, and export settings travel with a preset.</p>
      </div></details>
      <footer class="panel-footer">DESIGNED TO COME APART. BUILT TO FIT.</footer>
    </aside>
    <section class="preview-panel" aria-label="Live puzzle preview">
      <div class="preview-header"><div><span class="eyebrow">YOUR WORKSPACE</span><h2>Live preview <span class="live-dot"></span></h2></div><div class="preview-toggles">${toggle('colors', 'Colors')}${toggle('numbers', 'Numbers')}</div></div>
      <div class="canvas-topbar"><div class="segmented" aria-label="Preview mode"><button id="view-cut" data-view="cut">Shared cut lines</button><button id="view-pieces" data-view="pieces">Piece outlines</button><button id="view-mask" data-view="mask">Cutting mask</button></div><span id="mode-note">Nominal seams · no clearance</span></div>
      <div id="stage" class="stage" tabindex="0" aria-label="Puzzle canvas. Drag to pan, scroll to zoom, press 0 to fit.">
        <div class="canvas-corner top-left"></div><div class="canvas-corner bottom-right"></div>
        <svg id="preview" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Generated puzzle pattern"><g id="drawing"></g></svg>
        <div id="status" class="status" role="status" aria-live="polite"><span class="status-dot"></span><span id="status-text">Generating geometry…</span></div>
        <div id="error" class="error-banner" role="alert" hidden></div>
        <div id="warning" class="warning-banner" hidden></div>
        <div class="canvas-bottom"><span class="gesture-hint">DRAG TO PAN · SCROLL TO ZOOM</span><div class="zoom-toolbar"><button id="zoom-out" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button><output id="zoom-value">100%</output><button id="zoom-in" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><span></span><button id="fit" title="Fit to window (0)" aria-label="Fit to window">${icon('fit')}</button></div></div>
      </div>
      <div class="preview-stats"><div><small>ACTUAL PIECES</small><strong id="stat-count">—</strong></div><div><small>CANVAS SIZE</small><strong id="stat-size">200 × 160 <em>mm</em></strong></div><div><small>ACTUAL TAB DEPTH</small><strong id="stat-tabs">—</strong></div><div class="precision"><span>↗</span><p>True vector geometry<small>Millimeter-accurate SVG</small></p></div></div>
      <div class="workspace-footer"><span id="generation-info">Local geometry. No uploads. No account.</span><span>MADE FOR YOUR NEXT MAKE.</span></div>
    </section>
  </main>
  <dialog id="help-dialog"><div class="dialog-header"><span class="eyebrow">FROM PATTERN TO PRINT</span><button id="close-guide" class="icon-button" aria-label="Close guide">×</button></div><h2>Choose what to remove.</h2>
    <div class="note"><b>Bambu Studio Cut / negative part: use Cutting mask.</b><p>Black channels are removed; holes preserve the puzzle pieces. Attach the SVG to the same model with operation Cut / negative part. Align X/Y at the requested millimeter scale, and position its extrusion through the full model height. Slice and inspect the gaps. Piece outlines are the shapes to keep; subtracting them removes your pieces. Fill color does not reverse the operation.</p></div>
    <p>The cutting mask is a 2D pattern extruded through your model. Negative volumes act during slicing; for separately exportable solids use the CAD intersection workflow below. Cutting-mask exports omit all decorations and strokes. A positive clearance is required.</p>
    <ol><li><b>Download Piece outlines.</b> Each piece is a closed, white filled path with black lines and geometric clearance already applied. Disable export colors and numbers for CAD. White paths still enclose filled geometry.</li><li><b>In a CAD tool that supports SVG and solid booleans,</b> import at millimeter scale, extrude each profile beyond the full model height, and intersect a copy of the model with each piece’s solid. Keep all profiles at the same origin. Export the resulting solids as STL or 3MF.</li><li><b>Import the resulting solids into Bambu Studio.</b> Check their X/Y dimensions and arrange them for printing. The pattern follows a straight extrusion through the model; it is not a 3D surface wrap.</li></ol>
    <div class="note"><b>Direct SVG import is also supported.</b><p>Bambu Studio’s File → Import menu includes SVG, and its SVG tool has an extrusion depth. This creates SVG-shaped geometry; it does not automatically intersect your existing model into puzzle pieces. Check scale after import.</p></div>
    <p><b>Cut lines</b> contain one outer boundary and each nominal shared seam once. Clearance is not applied. These are open centerlines for CAD/sketch workflows; convert them to explicit closed cutting channels in CAD if you need subtraction solids. Do not rely on stroke thickness as kerf or a physical cut.</p>
    <p class="hint">Workflow checked against the <a href="https://csm.bblcdn.com/hub/4668d0ca43994ff3bff4b37f1a65c2e7.pdf" target="_blank" rel="noreferrer">Bambu Lab import manual</a> and <a href="https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/Gizmos/GLGizmoSVG.cpp" target="_blank" rel="noreferrer">Bambu Studio SVG tool source</a>, November 12, 2026. Keep SVG units at 1:1 scale; a mask can have smaller filled bounds than its canvas, especially for a single row or column. Align its original coordinates with your model rather than stretching its filled bounds to the canvas size. A full Bambu Studio print has not been tested here.</p>
    <h3>Geometry limits</h3><p>10–2000 mm per side; up to 200 pieces; 0–3 mm clearance. Tabs reserve room for at least a 0.5 mm neck after clearance. Short Voronoi seams are merged at shared vertices where valid, slightly adjusting the exact Voronoi boundaries while preserving piece count. Cleanup is reported in the preview. If a safe tab still cannot fit, try another seed, larger dimensions, fewer pieces, less clearance, or no tabs. Large requested depths are capped by local geometry; random tabs must still fit their minimum.</p>
    <p>Presets are stored on this browser and origin. Export JSON to move them between localhost, GitHub Pages, or another device. Clearing browser data removes local presets.</p>
    <button id="close-guide-bottom" class="primary">Back to the workshop</button>
  </dialog><div id="toast" class="toast" role="status" hidden></div>`;

let settings = { ...defaults };
let storageWarning = '';
try { const saved = localStorage.getItem('puzzle-foundry-current-v1'); if (saved) settings = validateSettings(JSON.parse(saved)); }
catch { storageWarning = 'Could not restore the last settings. Defaults loaded.'; }
let aspectRatio = settings.width / settings.height;
let presets: Preset[] = [];
try { presets = readPresets(); } catch { storageWarning = 'Preset storage is unavailable or invalid. Export JSON to keep a backup.'; }
let pattern: Pattern | undefined;
let diagnostic: Diagnostic | undefined;
let valid = false, timer: ReturnType<typeof setTimeout>, requestId = 0;
const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
const stage = $('#stage'), svg = $<SVGSVGElement>('#preview');
let view = { x: 0, y: 0, width: 250, height: 200 }, fitWidth = 250;
let lastDimensions = '';

function toast(message: string) { const t = $('#toast'); t.textContent = message; t.hidden = false; setTimeout(() => { t.hidden = true; }, 4200); }
function syncControls() {
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
    const value = settings[input.dataset.setting as keyof Settings];
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value as boolean;
    else input.value = String(value);
  }
  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-count]')) { chip.classList.toggle('active', +chip.dataset.count! === settings.count); chip.setAttribute('aria-pressed', String(+chip.dataset.count! === settings.count)); }
  const rect = settings.geometry === 'rectangular', grid = settings.distribution === 'grid';
  $<HTMLSelectElement>('#distribution').disabled = rect;
  const bySize = settings.sizingMode === 'size';
  $<HTMLInputElement>('#pieceSize').disabled = !bySize;
  $<HTMLInputElement>('#count').disabled = bySize;
  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-count]')) chip.disabled = bySize;
  $<HTMLSelectElement>('#gridMode').disabled = !rect || bySize;
  for (const k of ['rows', 'columns']) $<HTMLInputElement>(`#${k}`).disabled = !rect || settings.gridMode === 'auto' || bySize;
  $<HTMLInputElement>('#jitterEnabled').disabled = rect || !grid;
  $<HTMLInputElement>('#jitter').disabled = rect || !grid || !settings.jitterEnabled;
  $<HTMLInputElement>('#seamCurvature').disabled = !settings.curvatureEnabled;
  const l = layout(settings);
  $('#piece-size-hint').textContent = bySize ? `${l.rows} rows × ${l.columns} columns = ${l.rows * l.columns} pieces. Base size: ${(settings.width / l.columns).toFixed(2)} × ${(settings.height / l.rows).toFixed(2)} mm. Each dimension is divided by the target and rounded to the nearest whole piece (minimum 1). Tabs and clearance change the outline; Voronoi sizes vary.` : 'Choose target piece size to calculate the count automatically. Size describes the base cell before tabs and clearance.';
  if (bySize) $<HTMLInputElement>('#count').value = String(l.rows * l.columns);
  if (rect && (settings.gridMode === 'auto' || bySize)) {
    $<HTMLInputElement>('#rows').value = String(l.rows);
    $<HTMLInputElement>('#columns').value = String(l.columns);
  }
  $('#grid-hint').textContent = bySize ? 'Rows, columns, and count are calculated from target piece size. Switch to Piece count to edit these controls.' : rect ? `${l.rows} rows × ${l.columns} columns = ${l.rows * l.columns} actual pieces. ${settings.gridMode === 'manual' ? 'Custom layout takes priority over requested count.' : 'Select custom layout to edit rows and columns.'}` : 'Row/column controls apply to rectangular geometry. Voronoi uses the exact requested point count.';
  $('#distribution-hint').textContent = rect ? 'Point distribution is used only by Voronoi geometry.' : grid ? 'Seed points in rows, displaced by the grid jitter below.' : 'Seeded random points with a minimum-distance exclusion radius.';
  $('#jitter-hint').textContent = rect ? 'Disabled to preserve the row/column layout. Use Seam curvature to bend its seams.' : !grid ? 'Jitter applies to grid seed points, not Poisson disk.' : '0% gives regular grid points; 80% allows ±40% of cell spacing. Custom counts use balanced rows.';
  const noTabs = settings.tabStyle === 'none';
  $<HTMLInputElement>('#tabSize').disabled = noTabs || settings.randomTabs;
  $<HTMLInputElement>('#randomTabs').disabled = noTabs;
  $('#random-range').hidden = !settings.randomTabs;
  for (const k of ['tabMin', 'tabMax']) $<HTMLInputElement>(`#${k}`).disabled = noTabs;
  $('#tab-hint').textContent = noTabs ? 'Tab controls are disabled. Seam curvature can still bend the boundaries, and clearance still applies.' : settings.randomTabs ? 'One seeded depth per seam, within this range. If the minimum cannot fit, generation stops.' : settings.tabStyle === 'jigsaw' ? 'Classic rounded bulbs, narrow necks, and smooth shoulders. Depth is limited to fit the seam safely.' : 'Depth is limited by seam length and neighboring geometry. Keyed heads are twice as wide as their depth.';
  updateExportControls();
  for (const b of document.querySelectorAll<HTMLElement>('[data-view]')) { b.classList.toggle('active', b.dataset.view === settings.previewMode); b.setAttribute('aria-pressed', String(b.dataset.view === settings.previewMode)); }
  $('#mode-note').textContent = settings.previewMode === 'mask' ? `Red = material removed · ${pattern?.settings.clearance ?? settings.clearance} mm gap` : settings.previewMode === 'cut' ? 'Nominal seams · no clearance' : `Closed outlines · ${pattern?.settings.clearance ?? settings.clearance} mm gap`;
  syncNumericControls();
}
function updateExportControls() {
  const mask = settings.exportMode === 'mask';
  $<HTMLInputElement>('#exportColors').disabled = mask;
  $<HTMLInputElement>('#exportLabels').disabled = mask;
  $<HTMLInputElement>('#strokeWidth').disabled = mask;
  const problem = pattern && mask ? cuttingMaskError(pattern) : undefined;
  $('#export-hint').textContent = problem || (mask ? 'Filled cutting channels only: subtract these from the model to keep the puzzle pieces. Gap width is the actual clearance. Decorations and stroke width are disabled to protect cutter geometry.' : settings.exportMode === 'pieces' ? 'Filled puzzle pieces to KEEP. Use CAD intersection, not subtraction. Using these as a negative cutter removes the pieces and leaves the gaps.' : 'Nominal centerlines and outer boundary, not a negative cutter. Use Cutting mask for Bambu Cut / negative parts.');
  $<HTMLButtonElement>('#download').disabled = !valid || !!problem;
}
function syncNumericControls() {
  // Hide the whole field (including its slider/reset), keeping available switches visible.
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
    const field = input.closest<HTMLElement>('.field, .toggle');
    if (field) field.hidden = input.disabled;
  }
  document.querySelector<HTMLElement>('.count-chips')!.parentElement!.hidden = settings.sizingMode === 'size';
  for (const row of document.querySelectorAll<HTMLElement>('.two-col')) {
    if (row.querySelector('[data-setting]')) row.hidden = [...row.querySelectorAll<HTMLElement>(':scope > .field')].every(field => field.hidden);
  }
  $('#distribution-hint').hidden = settings.geometry === 'rectangular';
  $('#jitter-hint').hidden = $<HTMLInputElement>('#jitter').disabled;
  $('#curvature-description').hidden = !settings.curvatureEnabled;
  $('#curve-hint').hidden = !settings.curvatureEnabled;
  $('#tab-limit-hint').hidden = settings.tabStyle === 'none';
  $('#random-range').hidden = settings.tabStyle === 'none' || !settings.randomTabs;
  $('#custom-fit-values').hidden = !settings.customFits;
  for (const slider of document.querySelectorAll<HTMLInputElement>('[data-slider]')) {
    const key = slider.dataset.slider as keyof Settings;
    const input = $<HTMLInputElement>(`#${key}`);
    if (['tabSize', 'tabMin', 'tabMax'].includes(key)) {
      const capacity = pattern?.tabCapacity;
      // Random minimum must fit every seam; maximum/depth may be capped per seam.
      const maximum = capacity ? key === 'tabMin' ? capacity.min : capacity.max : 100;
      slider.min = '0.5'; slider.max = String(Math.max(.5, maximum)); slider.step = '0.01';
      input.max = slider.max; input.step = '0.01';
      slider.title = `Available depth up to ${slider.max} mm for this pattern`;
    }
    if (Number.isFinite(settings[key])) slider.value = input.value;
    slider.disabled = input.disabled;
    $<HTMLButtonElement>(`[data-reset="${key}"]`).disabled = input.disabled;
  }
  const capacity = pattern?.tabCapacity;
  $('#tab-limit-hint').textContent = capacity && settings.tabStyle !== 'none' ? `Slider limit: ${capacity.max.toFixed(2)} mm for the largest seam; ${capacity.min.toFixed(2)} mm fits every seam. Typed values above these limits are capped geometrically. Limits update after generation.` : 'Tab sliders adapt to seam length, piece proportions, and tab style.';
  const grid = layout(settings);
  const spacing = settings.geometry === 'rectangular' ? Math.min(settings.width / grid.columns, settings.height / grid.rows) : Math.sqrt(settings.width * settings.height / settings.count);
  const scale = Number.isFinite(spacing) ? Math.min(1, Math.max(0.2, spacing / 15)) : 1;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fit]')) {
    const custom = button.dataset.fit === '0.05' ? settings.fitSuperTight : button.dataset.fit === '0.15' ? settings.fitTight : settings.fitLoose;
    const gap = settings.customFits ? custom : Math.max(.01, Math.round(+button.dataset.fit! * scale * 100) / 100);
    button.dataset.gap = String(gap); button.querySelector('small')!.textContent = `${gap} mm`;
    button.disabled = !Number.isFinite(spacing);
  }
  $('#fit-hint').textContent = `${settings.customFits ? 'Custom suggestions use your exact values, without scaling.' : 'Suggested total gaps, scaled for your pieces.'} ${settings.autoClearance ? 'Unsafe gaps are reduced automatically.' : 'Exact clearance: unsafe gaps block export and affected cells turn red.'} Start with a test print.`;
}
function setBusy() { if (diagnostic) { diagnostic = undefined; render(); fit(); } document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid')); valid = false; $<HTMLButtonElement>('#download').disabled = true; $('#status').className = 'status busy'; $('#status-text').textContent = 'Generating geometry…'; }
function showError(message: string, detail?: Diagnostic) {
  valid = false; $<HTMLButtonElement>('#download').disabled = true;
  diagnostic = detail;
  if (detail?.parameter) document.getElementById(detail.parameter)?.setAttribute('aria-invalid', 'true');
  const error = $('#error'); error.textContent = `${message} ${detail ? 'Invalid draft: red cells block export. The last valid pattern is retained.' : pattern ? 'Showing the last valid pattern. Export is paused.' : 'Adjust settings to create a valid pattern.'}`; error.hidden = false;
  $('#status').className = 'status failed'; $('#status-text').textContent = 'Settings need attention';
  render(); if (detail) fit();
}
function schedule() {
  clearTimeout(timer); ++requestId; setBusy();
  timer = setTimeout(() => {
    try { const checked = validateSettings(settings); worker.postMessage({ id: requestId, settings: checked }); }
    catch (error) { showError((error as Error).message); }
  }, 160);
}
worker.onmessage = ({ data }) => {
  if (data.id !== requestId) return;
  if (data.error) { showError(data.error, data.diagnostic); return; }
  diagnostic = undefined;
  document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  pattern = data.pattern; valid = true;
  syncNumericControls();
  if (settings.clearance !== pattern!.settings.clearance) {
    settings.clearance = pattern!.settings.clearance;
    $<HTMLInputElement>('#clearance').value = String(settings.clearance);
    syncNumericControls();
  }
  // A preview/export toggle can change while the worker is running.
  for (const k of visualKeys) (pattern!.settings as unknown as Record<string, unknown>)[k] = settings[k];
  $('#error').hidden = true; $<HTMLButtonElement>('#download').disabled = false;
  $('#status').className = 'status'; $('#status-text').textContent = 'Geometry ready';
  $('#warning').hidden = !pattern!.warnings.length; $('#warning').textContent = pattern!.warnings.join(' ');
  render();
  const dimensionKey = `${pattern!.settings.width}x${pattern!.settings.height}`;
  if (dimensionKey !== lastDimensions) { lastDimensions = dimensionKey; fit(); }
  try { localStorage.setItem('puzzle-foundry-current-v1', JSON.stringify(settings)); } catch { toast('Browser storage is unavailable. Export presets to keep your settings.'); }
};
worker.onerror = () => showError('The geometry worker could not start. Reload the app from the local server, or rebuild the static site.');
const visualKeys: (keyof Settings)[] = ['colors', 'numbers', 'previewMode', 'exportMode', 'exportColors', 'exportLabels', 'strokeWidth', 'aspectLock', 'customFits', 'fitSuperTight', 'fitTight', 'fitLoose'];

function render() {
  updateExportControls();
  if (diagnostic) {
    const d = diagnostic, affected = new Set(d.affected);
    $('#drawing').innerHTML = d.cells.map((points, id) => `<path class="diagnostic-cell${affected.has(id) ? ' problematic-cell' : ''}" data-piece="${id + 1}" d="${pathData(points)}" fill="${affected.has(id) ? '#f18a82' : '#ffffff'}" stroke="${affected.has(id) ? '#b42318' : '#89968b'}" stroke-width="${Math.min(d.width, d.height) / 250}"><title>Piece ${id + 1}${affected.has(id) ? ': geometry blocks export' : ''}</title></path>`).join('');
    $('#mode-note').textContent = 'Invalid draft cells · red cells block export';
    $('#stat-count').textContent = String(d.cells.length);
    $('#stat-size').textContent = `${d.width} × ${d.height} mm`;
    $('#stat-tabs').textContent = 'Invalid draft';
    $('#generation-info').textContent = `Affected pieces: ${d.affected.map(id => id + 1).join(', ')} · export paused`;
    return;
  }
  if (!pattern) return;
  const p = pattern, s = p.settings, maskView = settings.previewMode === 'mask', pieces = settings.previewMode !== 'cut';
  const lineColor = settings.colors ? '#324e40' : '#000000';
  $('#mode-note').textContent = pieces ? `Closed outlines · ${s.clearance} mm gap` : 'Nominal seams · no clearance';
  let markup = '';
  for (const piece of p.pieces) markup += `<path class="piece-fill" d="${pathData(pieces ? piece.outline : piece.nominal)}" fill="${settings.colors ? palette[piece.id % palette.length] : '#ffffff'}" ${pieces ? `stroke="${lineColor}" stroke-width="${settings.strokeWidth}"` : 'stroke="none"'}><title>Piece ${piece.id + 1}</title></path>`;
  if (!pieces) {
    markup += `<g class="preview-cut-lines" fill="none" stroke="${lineColor}" stroke-width="${settings.strokeWidth}" stroke-linejoin="miter"><path d="M0 0H${s.width}V${s.height}H0Z"/>`;
    for (const e of p.edges.filter(e => e.cells.length === 2)) markup += `<path d="${pathData(e.points, false)}"/>`;
    markup += '</g>';
  }
  if (maskView && !cuttingMaskError(p)) markup += `<path class="mask-preview" d="${cuttingMask(p).map(points => pathData(points)).join(' ')}" fill="#e05246" fill-rule="evenodd" stroke="none"/>`;
  if (maskView) $('#mode-note').textContent = cuttingMaskError(p) || `Red = material removed · ${s.clearance} mm gap`;
  if (settings.numbers) for (const piece of p.pieces) markup += `<text class="piece-number" x="${piece.center[0]}" y="${piece.center[1]}" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(4, Math.sqrt(s.width * s.height / p.pieces.length) / 7)}" fill="${settings.colors ? '#3d5143' : '#000000'}">${piece.id + 1}</text>`;
  const offset = Math.min(s.width, s.height) * 0.08, textSize = offset * 0.4;
  markup += `<g class="dimension-lines" fill="none" stroke="#89968b" stroke-width="${offset * .035}"><path d="M0 ${-offset * .5}V${-offset * 1.5} M${s.width} ${-offset * .5}V${-offset * 1.5} M0 ${-offset}H${s.width}"/><path d="M${-offset * .5} 0H${-offset * 1.5} M${-offset * .5} ${s.height}H${-offset * 1.5} M${-offset} 0V${s.height}"/></g><g fill="#718074" font-family="monospace" font-size="${textSize}"><text x="${s.width / 2}" y="${-offset * 1.35}" text-anchor="middle">${s.width} mm</text><text transform="translate(${-offset * 1.35},${s.height / 2}) rotate(-90)" text-anchor="middle">${s.height} mm</text></g>`;
  $('#drawing').innerHTML = markup;
  $('#stat-count').textContent = String(p.pieces.length);
  $('#stat-size').innerHTML = `${s.width} × ${s.height} <em>mm</em>`;
  $('#stat-tabs').innerHTML = p.maxTab ? `${p.minTab.toFixed(2)}${p.maxTab - p.minTab > .005 ? `–${p.maxTab.toFixed(2)}` : ''} <em>mm</em>` : 'None';
  $('#curve-hint').textContent = s.seamCurvature ? `Actual bend: ${p.minCurve.toFixed(2)}–${p.maxCurve.toFixed(2)} mm. Larger tabs leave less room for curves.` : '';
  $('#generation-info').textContent = `${s.geometry === 'rectangular' ? `${p.rows} × ${p.columns} grid` : `${s.distribution === 'poisson' ? 'Poisson' : 'Grid'} Voronoi`} · ${p.edges.filter(e => e.cells.length === 2).length} shared seams · ${Math.round(p.elapsed)} ms`;
}
function applyView() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`); $('#zoom-value').textContent = `${Math.round(fitWidth / view.width * 100)}%`; }
function fit() {
  if ((!pattern && !diagnostic) || !stage.clientWidth || !stage.clientHeight) return;
  const s = diagnostic || pattern!.settings, ratio = stage.clientWidth / stage.clientHeight;
  const height = Math.max(s.height * 1.5, s.width * 1.5 / ratio), width = height * ratio;
  view = { x: (s.width - width) / 2, y: (s.height - height) / 2, width, height }; fitWidth = width; applyView();
}
function zoom(factor: number, fx = .5, fy = .5) {
  const newWidth = Math.min(fitWidth * 5, Math.max(fitWidth / 20, view.width * factor));
  const f = newWidth / view.width;
  view = { x: view.x + view.width * fx * (1 - f), y: view.y + view.height * fy * (1 - f), width: newWidth, height: view.height * f }; applyView();
}
stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoom(Math.exp(e.deltaY * .0015), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
let drag: { x: number; y: number; startX: number; startY: number; id: number } | undefined;
stage.addEventListener('pointerdown', e => { if ((e.target as Element).closest('button') || e.button !== 0) return; drag = { x: view.x, y: view.y, startX: e.clientX, startY: e.clientY, id: e.pointerId }; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
stage.addEventListener('pointermove', e => { if (!drag || drag.id !== e.pointerId) return; view.x = drag.x - (e.clientX - drag.startX) * view.width / stage.clientWidth; view.y = drag.y - (e.clientY - drag.startY) * view.height / stage.clientHeight; applyView(); });
const endDrag = () => { drag = undefined; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('keydown', e => { if (e.key === '0') fit(); if (e.key === '+' || e.key === '=') zoom(.8); if (e.key === '-') zoom(1.25); });
$('#fit').addEventListener('click', fit); $('#zoom-in').addEventListener('click', () => zoom(.8)); $('#zoom-out').addEventListener('click', () => zoom(1.25));
new ResizeObserver(() => fit()).observe(stage);

for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) input.addEventListener('input', () => {
  const k = input.dataset.setting as keyof Settings;
  const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input instanceof HTMLInputElement && (input.type === 'number' || input.type === 'range') ? input.valueAsNumber : input.value;
  (settings as unknown as Record<string, unknown>)[k] = value;
  if (k === 'exportMode' && value === 'mask') settings.previewMode = 'mask';
  if (k === 'aspectLock' && settings.aspectLock && Number.isFinite(settings.width / settings.height) && settings.width > 0 && settings.height > 0) aspectRatio = settings.width / settings.height;
  if (settings.aspectLock && (k === 'width' || k === 'height') && Number.isFinite(value)) {
    if (k === 'width') settings.height = +(settings.width / aspectRatio).toFixed(3);
    else settings.width = +(settings.height * aspectRatio).toFixed(3);
  }
  // Avoid resetting a partially edited numeric/text input or moving the seed caret.
  if (k === 'width' && settings.aspectLock) $<HTMLInputElement>('#height').value = String(settings.height);
  if (k === 'height' && settings.aspectLock) $<HTMLInputElement>('#width').value = String(settings.width);
  if (!['width', 'height', 'seed', 'count', 'rows', 'columns', 'tabSize', 'tabMin', 'tabMax', 'clearance', 'strokeWidth'].includes(k)) syncControls();
  if (['count', 'rows', 'columns', 'pieceSize', 'width', 'height'].includes(k) && Number.isFinite(value)) { const active = document.activeElement; syncControls(); (active as HTMLElement)?.focus(); }
  if (visualKeys.includes(k)) {
    try {
      validateSettings(settings);
      if (pattern && valid) pattern.settings = { ...settings };
      else schedule();
      render();
      if (valid) try { localStorage.setItem('puzzle-foundry-current-v1', JSON.stringify(settings)); } catch { /* preset export stays available */ }
    } catch (error) { ++requestId; clearTimeout(timer); showError((error as Error).message); }
    if (k === 'exportMode') syncControls();
  } else schedule();
  syncNumericControls();
});
for (const slider of document.querySelectorAll<HTMLInputElement>('[data-slider]')) slider.addEventListener('input', () => {
  const input = $<HTMLInputElement>(`#${slider.dataset.slider}`);
  input.value = slider.value; input.dispatchEvent(new Event('input', { bubbles: true }));
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reset]')) button.addEventListener('click', () => {
  const key = button.dataset.reset as keyof Settings, input = $<HTMLInputElement>(`#${key}`);
  input.value = String(defaults[key]); input.dispatchEvent(new Event('input', { bubbles: true }));
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fit]')) button.addEventListener('click', () => {
  const input = $<HTMLInputElement>('#clearance'); input.value = button.dataset.gap!;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-count]')) chip.addEventListener('click', () => { settings.count = +chip.dataset.count!; syncControls(); schedule(); });
for (const b of document.querySelectorAll<HTMLElement>('[data-view]')) b.addEventListener('click', () => { settings.previewMode = b.dataset.view as Settings['previewMode']; if (pattern) pattern.settings.previewMode = settings.previewMode; syncControls(); render(); });
$('#new-seed').addEventListener('click', () => { settings.seed = `seed-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`; syncControls(); schedule(); });
function download(content: string, filename: string, type: string) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
$('#download').addEventListener('click', () => { if (!pattern || !valid) return; pattern.settings = { ...settings }; try { download(exportSvg(pattern), svgFilename(pattern), 'image/svg+xml'); toast(settings.exportMode === 'mask' ? 'Cutting mask downloaded. Use as Cut / negative part; extrude through the full model height.' : 'SVG downloaded. Keep the millimeter scale when importing.'); } catch (error) { toast((error as Error).message); } });

function refreshPresets(selected?: string) {
  const select = $<HTMLSelectElement>('#preset-select'); const current = selected || select.value;
  select.innerHTML = presets.length ? presets.map(p => `<option value="${escapeXml(p.id)}">${escapeXml(p.name)}</option>`).join('') : '<option value="">No saved presets</option>';
  if (presets.some(p => p.id === current)) select.value = current;
  const p = presets.find(p => p.id === select.value); $<HTMLInputElement>('#preset-name').value = p?.name || '';
  for (const id of ['load-preset', 'update-preset', 'rename-preset', 'duplicate-preset', 'delete-preset']) $<HTMLButtonElement>(`#${id}`).disabled = !p;
}
const selectedPreset = () => presets.find(p => p.id === $<HTMLSelectElement>('#preset-select').value);
function savePresets(next: Preset[], selected?: string) {
  if (next.length > 100) throw new Error('Keep at most 100 presets. Export a backup, then delete unused presets.');
  writePresets(next); presets = next; refreshPresets(selected); $('#preset-message').textContent = 'Saved in this browser. Export JSON for a portable backup.';
}
function presetAction(action: () => void) { try { action(); } catch (error) { $('#preset-message').textContent = (error as Error).message; toast((error as Error).message); } }
function presetName() { const name = $<HTMLInputElement>('#preset-name').value.trim(); if (!name) throw new Error('Give your preset a name first.'); return name; }
$('#preset-select').addEventListener('change', () => { const p = selectedPreset(); $<HTMLInputElement>('#preset-name').value = p?.name || ''; });
$('#save-preset').addEventListener('click', () => presetAction(() => { const p = { id: crypto.randomUUID(), name: presetName(), settings: validateSettings(settings) }; savePresets([...presets, p], p.id); toast('New preset saved.'); }));
$('#load-preset').addEventListener('click', () => { const p = selectedPreset(); if (p) { settings = structuredClone(p.settings); aspectRatio = settings.width / settings.height; syncControls(); schedule(); toast(`Loaded ${p.name}.`); } });
$('#update-preset').addEventListener('click', () => presetAction(() => { const p = selectedPreset(); if (p) { const next = presets.map(v => v.id === p.id ? { ...v, settings: validateSettings(settings) } : v); savePresets(next, p.id); toast('Preset settings updated.'); } }));
$('#rename-preset').addEventListener('click', () => presetAction(() => { const p = selectedPreset(); if (p) savePresets(presets.map(v => v.id === p.id ? { ...v, name: presetName() } : v), p.id); }));
$('#duplicate-preset').addEventListener('click', () => presetAction(() => { const p = selectedPreset(); if (p) { const copy = { ...structuredClone(p), id: crypto.randomUUID(), name: `${p.name.slice(0, 90)} (copy)` }; savePresets([...presets, copy], copy.id); } }));
$('#delete-preset').addEventListener('click', () => presetAction(() => { const p = selectedPreset(); if (p) { const next = presets.filter(v => v.id !== p.id); savePresets(next); toast(`Deleted ${p.name}.`); } }));
$('#export-presets').addEventListener('click', () => download(JSON.stringify({ version: 1, presets }, null, 2), 'puzzle-foundry-presets.json', 'application/json'));
$('#import-presets').addEventListener('click', () => $<HTMLInputElement>('#preset-file').click());
$('#preset-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#preset-file'), file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Preset JSON must be smaller than 2 MB.');
    const imported = parsePresets(JSON.parse(await file.text()));
    // Import appends copies. Existing presets are never overwritten by a file.
    const copies = imported.map(p => ({ ...p, id: crypto.randomUUID() }));
    savePresets([...presets, ...copies], copies[0]?.id); toast(`Imported ${copies.length} presets.`);
  } catch (error) { $('#preset-message').textContent = (error as Error).message; } finally { input.value = ''; }
});
for (const id of ['guide', 'guide-link']) $(`#${id}`).addEventListener('click', () => $<HTMLDialogElement>('#help-dialog').showModal());
for (const id of ['close-guide', 'close-guide-bottom']) $(`#${id}`).addEventListener('click', () => $<HTMLDialogElement>('#help-dialog').close());
syncControls(); refreshPresets(); schedule();
if (storageWarning) toast(storageWarning);

$('#image-workshop').addEventListener('click', async () => { const { openImageWorkshop } = await import('./image-workshop'); openImageWorkshop({ ...settings }); });
