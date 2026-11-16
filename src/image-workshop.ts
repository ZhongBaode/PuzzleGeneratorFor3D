import './image-workshop.css';
import { basicSwatches, detectPalette, mapRaster, rasterSize, rgb } from './image-colors';
import type { Raster, Model } from './image-model';
import { type Pattern } from './geometry';
import { defaults, validateSettings, type Settings } from './settings';
import { escapeXml, pathData } from './svg';
import { createModelViewer } from './image-viewer';

export function openImageWorkshop(current: Settings) {
  const dialog = document.createElement('dialog'); dialog.className = 'image-workshop';
  dialog.setAttribute('aria-label', 'Image puzzle workshop'); document.body.append(dialog);
  dialog.innerHTML = `<header class="iw-header"><div><span class="eyebrow">IMAGE → FOUR COLORS → PRINT</span><h2>Image puzzle workshop</h2><p>Local processing · four AMS slots · 16:9</p></div><button type="button" id="iw-close" aria-label="Close image workshop">×</button></header><div class="iw-layout"><section class="iw-controls"></section><section class="iw-preview" aria-label="Image and model preview"></section></div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#iw-${id}`)!;
  const controls = dialog.querySelector<HTMLElement>('.iw-controls')!, preview = dialog.querySelector<HTMLElement>('.iw-preview')!;
  let step = 1, image: ImageBitmap | undefined, sourceName = '', width = 256, nozzle = .4, size = '256', zoom = 1, cropX = .5, cropY = .5;
  let automatic = true, colors = ['#FFFFFF', '#000000', '#C12E1F', '#0A2989'], backing = 0;
  let raster: Raster | undefined, model: Model | undefined, pattern: Pattern | undefined, exploded = true, plate = 0;
  let cutSettings: Settings = { ...current, sizingMode: 'count' as const, gridMode: 'auto' as const, aspectLock: false };
  let worker: Worker | undefined, job = 0, busy = false, disposed = false, disposeViewer: (() => void) | undefined;
  let pending: ((v: any) => void) | undefined;
  let disabledControls = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();
  function stop() { job++; worker?.terminate(); worker = undefined; busy = false; pending?.(undefined); pending = undefined; }
  const status = (message: string) => { if ($('status')) $('status').textContent = message; };
  function error(e: unknown) { if ($('error')) { $('error').hidden = false; $('error').textContent = e instanceof Error ? e.message : String(e); } }
  function clearError() { if ($('error')) $('error').hidden = true; }
  function setBusy(value: boolean) {
    busy = value;
    if (value) {
      disabledControls = new Map();
      controls.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button:not(#iw-back)').forEach(el => { disabledControls.set(el, el.disabled); el.disabled = true; });
    } else {
      disabledControls.forEach((disabled, el) => { el.disabled = disabled; }); disabledControls.clear();
    }
  }
  function run(payload: Record<string, unknown>): Promise<any> {
    stop(); setBusy(true); clearError(); status('Generating and verifying geometry…');
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }); const id = ++job;
    return new Promise(resolve => {
      pending = resolve;
      worker!.onmessage = ({ data }) => {
        if (id !== job || disposed) return;
        worker?.terminate(); worker = undefined; pending = undefined; setBusy(false);
        if (data.error) { error(data.error); status('Generation needs attention.'); resolve(undefined); } else resolve(data);
      };
      worker!.onerror = e => { if (id !== job) return; stop(); setBusy(false); error(e.message || 'Worker stopped unexpectedly.'); status('Generation failed.'); resolve(undefined); };
      worker!.postMessage({ ...payload, id });
    });
  }
  const field = (id: string, label: string, html: string) => `<label class="field" for="iw-${id}"><span>${label}</span>${html}</label>`;
  const input = (id: string, label: string, value: number, min: number, max: number, stride = 1) => field(id, label, `<input id="iw-${id}" type="number" min="${min}" max="${max}" step="${stride}" value="${value}">`);
  const select = (id: string, label: string, options: [string, string][], value: string) => field(id, label, `<select id="iw-${id}">${options.map(([v, t]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${t}</option>`).join('')}</select>`);
  const listen = (id: string, event: string, fn: () => void) => $(id).addEventListener(event, fn);
  const check = (id: string) => $<HTMLInputElement>(id).checked;
  const val = (id: string) => $<HTMLInputElement>(id).value;
  const num = (id: string) => $<HTMLInputElement>(id).valueAsNumber;
  function cropped(w: number, h: number) {
    if (!image) throw new Error('Choose an image first.');
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let sw = image.width, sh = sw * 9 / 16;
    if (sh > image.height) { sh = image.height; sw = sh * 16 / 9; }
    sw /= zoom; sh /= zoom;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image, (image.width - sw) * cropX, (image.height - sh) * cropY, sw, sh, 0, 0, w, h);
    return canvas;
  }
  function drawCrop() { if (image) { const c = cropped(640, 360); c.id = 'iw-crop-preview'; c.className = 'iw-image'; $('image-host').replaceChildren(c); } }
  function drawRaster(host = 'flat-host') {
    if (!raster) return;
    const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height; canvas.className = 'iw-image'; canvas.id = 'iw-color-preview';
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(raster.width, raster.height), palette = colors.map(rgb);
    raster.labels.forEach((slot, i) => { pixels.data.set([...palette[slot], 255], i * 4); }); ctx.putImageData(pixels, 0, 0);
    $(host).replaceChildren(canvas);
  }
  function actions(back: boolean, label: string, id: string) {
    controls.insertAdjacentHTML('beforeend', `<p id="iw-error" class="iw-error" role="alert" hidden></p><p id="iw-status" class="iw-status" role="status"></p><div class="iw-actions">${back ? '<button id="iw-back" type="button" class="secondary">Back</button>' : ''}<button type="button" id="iw-${id}" class="primary" data-work>${label}</button></div>`);
    if (back) listen('back', 'click', () => { stop(); step--; render(); });
  }
  function showViewer(m: Model) {
    disposeViewer?.(); disposeViewer = undefined;
    try { disposeViewer = createModelViewer($('viewer'), m, plate); }
    catch { $('viewer').textContent = '3D preview is unavailable on this device. Use the top view and thickness summary to review the model.'; }
  }
  function render() {
    disposeViewer?.(); disposeViewer = undefined; clearError(); controls.innerHTML = `<nav class="iw-steps" aria-label="Generation steps">${['Image', 'Colors', 'Model', 'Cuts', 'Download'].map((s, i) => i + 1 === step ? `<b aria-current="step">${i + 1} ${s}</b>` : `<span>${i + 1} ${s}</span>`).join('')}</nav>`;
    preview.innerHTML = '';
    if (step === 1) renderImage(); else if (step === 2) renderColors(); else if (step === 3) renderModel(); else if (step === 4) renderCuts(); else renderDownload();
  }
  function renderImage() {
    controls.insertAdjacentHTML('beforeend', `<h3>Choose an image & crop</h3><p class="hint">PNG, JPEG, WebP or BMP · up to 20 MB. Transparent pixels are placed over white. Nothing leaves your device.</p><input id="iw-file" aria-label="Input image" type="file" accept="image/png,image/jpeg,image/webp,image/bmp"><p id="iw-file-name" class="hint"></p>${select('size', 'Model size · 16:9', [['256', '256 × 144 mm'], ['224', '224 × 126 mm'], ['192', '192 × 108 mm'], ['160', '160 × 90 mm'], ['128', '128 × 72 mm'], ['custom', 'Custom width · keep 16:9']], size)}<div id="iw-custom" ${size === 'custom' ? '' : 'hidden'}>${input('width', 'Width (mm)', width, 32, 256, .1)}<p class="iw-warning">Custom scaling may lose fine image details. A model near the bed edge leaves less room for a brim or printer exclusion zones.</p></div><p id="iw-dimensions" class="hint"></p><span>Nozzle diameter</span><div class="iw-nozzles">${[.4, .2].map(n => `<button type="button" id="iw-nozzle-${n * 10}" aria-pressed="${nozzle === n}">${n.toFixed(1)} mm${n === .4 ? ' · default' : ''}</button>`).join('')}</div><p id="iw-layer-info" class="hint"></p>${['zoom', 'crop-x', 'crop-y'].map((id, i) => field(id, ['Crop zoom', 'Horizontal position', 'Vertical position'][i], `<input id="iw-${id}" type="range" min="${i ? 0 : 1}" max="${i ? 1 : 3}" step="0.01" value="${i ? i === 1 ? cropX : cropY : zoom}">`)).join('')}`);
    preview.innerHTML = '<h3>16:9 crop preview</h3><div id="iw-image-host"><p class="hint">Choose an image to begin.</p></div><p class="hint">The crop shown here becomes the model. Use the sliders to keep the important parts in frame.</p>';
    actions(false, 'Continue to colors', 'to-colors'); $('file-name').textContent = sourceName;
    const updateInfo = () => {
      const rs = rasterSize(Number.isFinite(width) ? width : 256, nozzle);
      $('dimensions').textContent = `${Number.isFinite(width) ? width : '—'} × ${Number.isFinite(width) ? +(width * 9 / 16).toFixed(3) : '—'} mm`;
      $('layer-info').textContent = `${nozzle === .4 ? '0.20' : '0.10'} mm layers · 7 backing + 3 color = ${nozzle === .4 ? '2.0' : '1.0'} mm thick. Detail grid ${rs.width} × ${rs.height}; narrow details can disappear.`;
      $('to-colors').toggleAttribute('disabled', !image);
    };
    listen('file', 'change', async () => {
      const file = $<HTMLInputElement>('file').files?.[0]; if (!file) return;
      clearError(); const token = ++job; setBusy(true); status('Decoding image…');
      try {
        if (file.size > 20 * 1024 * 1024 || !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP or BMP file no larger than 20 MB.');
        const decoded = await createImageBitmap(file);
        if (disposed || token !== job) { decoded.close(); return; }
        if (decoded.width * decoded.height > 40_000_000) { decoded.close(); throw new Error('Image exceeds 40 megapixels. Resize it first.'); }
        image?.close(); image = decoded; sourceName = file.name; zoom = 1; cropX = cropY = .5;
        $('file-name').textContent = sourceName;
        for (const [id, value] of [['zoom', 1], ['crop-x', .5], ['crop-y', .5]] as const) $<HTMLInputElement>(id).value = String(value);
        drawCrop(); status('Image ready.');
      } catch (e) { if (!disposed && token === job) error(e); }
      finally { if (!disposed && token === job) { setBusy(false); updateInfo(); } }
    });
    listen('size', 'change', () => { size = val('size'); $('custom').hidden = size !== 'custom'; if (size !== 'custom') { width = +size; $<HTMLInputElement>('width').value = String(width); } updateInfo(); });
    listen('width', 'input', () => { width = num('width'); updateInfo(); });
    for (const n of [.4, .2]) listen(`nozzle-${n * 10}`, 'click', () => { nozzle = n; for (const nn of [.4, .2]) $(`nozzle-${nn * 10}`).setAttribute('aria-pressed', String(nozzle === nn)); updateInfo(); });
    for (const id of ['zoom', 'crop-x', 'crop-y']) listen(id, 'input', () => { zoom = num('zoom'); cropX = num('crop-x'); cropY = num('crop-y'); drawCrop(); });
    listen('to-colors', 'click', () => {
      try {
        if (busy) return; if (!Number.isFinite(width) || width < 32 || width > 256) throw new Error('Choose a width from 32 to 256 mm.');
        raster = undefined; step = 2; render();
      } catch (e) { error(e); }
    });
    drawCrop(); updateInfo();
  }
  function classify(detect: boolean) {
    const rs = rasterSize(width, nozzle), canvas = cropped(rs.width, rs.height), data = canvas.getContext('2d')!.getImageData(0, 0, rs.width, rs.height).data;
    if (detect) colors = detectPalette(data);
    raster = mapRaster(data, rs.width, rs.height, colors);
  }
  function renderColors() {
    if (!raster) classify(automatic);
    controls.insertAdjacentHTML('beforeend', `<h3>Confirm four AMS colors</h3><label class="iw-toggle"><input id="iw-auto" type="checkbox" ${automatic ? 'checked' : ''}><span>Beta · automatically detect four colors<br><small>Off uses your chosen palette for nearest-color mapping.</small></span></label><div class="iw-palette">${colors.map((c, i) => `<div class="iw-slot"><label for="iw-color-${i}">AMS ${i + 1}</label><input id="iw-color-${i}" type="color" value="${c}" aria-label="AMS ${i + 1} color wheel"><output id="iw-hex-${i}">${c}</output><select id="iw-swatch-${i}" aria-label="AMS ${i + 1} PLA Basic preset"><option value="">Custom color</option>${basicSwatches.map(([name, color]) => `<option value="${color}">${name}</option>`).join('')}</select></div>`).join('')}</div><p class="hint">PLA Basic named swatches are screen approximations, not calibrated filament matches. Editing a slot recolors its detected regions. No dithering or extra filaments.</p>${select('backing', 'Backing · use one of these four slots', colors.map((_, i) => [String(i), `AMS ${i + 1}`]), String(backing))}<button id="iw-remap" class="secondary" type="button">Remap image to current palette</button>`);
    preview.innerHTML = '<h3>Four-color print preview</h3><div id="iw-flat-host"></div><p class="hint">Fine details are sampled to the nozzle-aware grid. Inspect the preview before confirming. Fewer than four distinct colors may be used for a simple image.</p>';
    actions(true, 'Confirm colors & generate model', 'to-model'); drawRaster();
    listen('auto', 'change', () => { automatic = check('auto'); classify(automatic); for (let i = 0; i < 4; i++) { $<HTMLInputElement>(`color-${i}`).value = colors[i]; $(`hex-${i}`).textContent = colors[i]; $<HTMLSelectElement>(`swatch-${i}`).value = ''; } drawRaster(); });
    for (let i = 0; i < 4; i++) {
      const update = (swatch: boolean) => { const value = val(swatch ? `swatch-${i}` : `color-${i}`); if (!value) return; colors[i] = value.toUpperCase(); $<HTMLInputElement>(`color-${i}`).value = colors[i]; $(`hex-${i}`).textContent = colors[i]; if (!swatch) $<HTMLSelectElement>(`swatch-${i}`).value = ''; drawRaster(); };
      listen(`color-${i}`, 'input', () => update(false)); listen(`swatch-${i}`, 'change', () => update(true));
    }
    listen('backing', 'change', () => { backing = +val('backing'); });
    listen('remap', 'click', () => { classify(false); drawRaster(); });
    listen('to-model', 'click', async () => {
      if (busy) return;
      const result = await run({ action: 'model', raster, palette: colors, backing, nozzle, exploded: false, settings: { ...defaults, width, height: width * 9 / 16, count: 1, tabStyle: 'none', clearance: 0 } });
      if (!result) return; model = result.model; step = 3; plate = 0; render();
    });
  }
  function renderModel() {
    controls.insertAdjacentHTML('beforeend', `<h3>Confirm the flat model</h3><p class="hint">${width} × ${+(width * 9 / 16).toFixed(3)} mm<br>${model!.layer.toFixed(2)} mm layer height · ${nozzle} mm nozzle<br><b>7 backing layers</b> in AMS ${backing + 1}<br><b>3 color layers</b> · ${(10 * model!.layer).toFixed(1)} mm total</p><p class="hint">Each color is solid geometry, not a texture. All colors finish at the same flat top surface.</p><p class="hint">Verified closed volumes and full image coverage. Drag the 3D view to inspect the top, backing and edges.</p>`);
    preview.innerHTML = '<h3>Model preview · actual thickness</h3><div id="iw-viewer" class="iw-viewer"></div><details><summary>Top view</summary><div id="iw-flat-host"></div></details>';
    actions(true, 'Confirm model & choose cuts', 'to-cuts'); drawRaster(); showViewer(model!);
    listen('to-cuts', 'click', () => { step = 4; pattern = undefined; render(); });
  }
  function readCuts() {
    cutSettings = validateSettings({ ...cutSettings, width, height: width * 9 / 16, count: num('count'), geometry: val('geometry'), tabStyle: val('tabs'), tabSize: num('depth'), randomTabs: false, clearance: num('clearance'), autoClearance: false, seed: val('seed'), seamCurvature: 0, curvatureEnabled: false });
    return cutSettings;
  }
  function renderCuts() {
    controls.insertAdjacentHTML('beforeend', `<h3>Choose & confirm puzzle cuts</h3>${input('count', 'Requested pieces', cutSettings.count, 2, 200)}${select('geometry', 'Piece geometry', [['rectangular', 'Rectangular'], ['voronoi', 'Voronoi']], cutSettings.geometry)}${select('tabs', 'Tab shape', [['jigsaw', 'Rounded jigsaw'], ['rectangular', 'Rectangular'], ['triangular', 'Triangular'], ['none', 'None']], cutSettings.tabStyle)}${input('depth', 'Tab depth (mm)', cutSettings.tabSize, .5, 100, .1)}${input('clearance', 'Total cut tolerance (mm)', cutSettings.clearance, 0, 3, .01)}${field('seed', 'Puzzle seed', `<input id="iw-seed" value="${escapeXml(cutSettings.seed)}" maxlength="120">`)}<label class="iw-toggle"><input id="iw-explode" type="checkbox" ${exploded ? 'checked' : ''}><span>Explode & arrange pieces for printing<br><small>Add 2 mm spacing beyond cut tolerance. Pack within 256 × 256 mm plates; use more plates if needed.</small></span></label><p class="hint">Off preserves the assembled picture with only the chosen cut tolerance. Zero tolerance can fuse neighboring pieces in a print.</p><button type="button" class="secondary" id="iw-generate-cuts" data-work>Generate cut preview</button>`);
    preview.innerHTML = '<h3>Cut tolerance preview</h3><div class="iw-cuts"><div id="iw-flat-host"></div><svg id="iw-cut-overlay" aria-label="Puzzle cut preview"></svg></div><p class="hint" id="iw-cut-summary">Generate the preview to inspect cuts over the image. The same piece outlines clip all ten model layers.</p>';
    actions(true, 'Confirm cuts & generate pieces', 'to-download'); drawRaster(); $<HTMLButtonElement>('to-download').disabled = true;
    const invalidate = () => { pattern = undefined; $<HTMLButtonElement>('to-download').disabled = true; $('cut-overlay').innerHTML = ''; $('cut-summary').textContent = 'Settings changed. Generate a new cut preview before confirming.'; };
    for (const id of ['count', 'geometry', 'tabs', 'depth', 'clearance', 'seed']) listen(id, 'input', () => { stop(); setBusy(false); invalidate(); });
    listen('explode', 'change', () => { exploded = check('explode'); });
    listen('generate-cuts', 'click', async () => {
      try {
        if (busy) return; if (num('count') < 2) throw new Error('Choose at least two puzzle pieces.');
        const settings = readCuts(); invalidate();
        const result = await run({ action: 'cuts', settings }); if (!result) return;
        pattern = result.pattern;
        $('cut-overlay').setAttribute('viewBox', `0 0 ${width} ${width * 9 / 16}`);
        $('cut-overlay').innerHTML = `<path fill="#15271b" fill-opacity=".42" fill-rule="evenodd" d="M0 0H${width}V${width * 9 / 16}H0Z ${pattern!.pieces.map(p => pathData(p.outline)).join(' ')}"/>${pattern!.pieces.map(p => `<path d="${pathData(p.outline)}" fill="none" stroke="white" stroke-width="${Math.max(.08, width / 1000)}"/>`).join('')}`;
        $('cut-summary').textContent = `${pattern!.pieces.length} actual pieces · ${pattern!.settings.clearance} mm cut tolerance. ${pattern!.warnings.join(' ')}`;
        status('Cut preview ready.'); $<HTMLButtonElement>('to-download').disabled = false;
      } catch (e) { error(e); }
    });
    listen('to-download', 'click', async () => {
      if (busy || !pattern) return;
      const result = await run({ action: 'model', raster, palette: colors, backing, nozzle, exploded, settings: pattern.settings });
      if (!result) return; model = result.model; step = 5; plate = 0; render();
    });
  }
  function renderDownload() {
    const m = model!;
    controls.insertAdjacentHTML('beforeend', `<h3>Printable puzzle pieces</h3><p class="hint">${m.pieces.length} pieces · ${m.plates} plate${m.plates === 1 ? '' : 's'}<br>${m.layer.toFixed(2)} mm layers · ${(10 * m.layer).toFixed(1)} mm thick<br>Cut tolerance: ${m.clearance} mm<br>${m.exploded ? `Exploded: 2 mm extra spacing.<br>Bounding boxes separated by ≥ ${m.spacing.toFixed(2)} mm.` : 'Assembled layout · explosion off.'}</p><p class="hint">Every exported color volume passed closed-boundary, winding and coverage checks. Download contains one multipart object per puzzle piece.</p><p class="iw-warning">In Bambu Studio, keep color parts together, map AMS slots 1–4, and use ${m.layer.toFixed(2)} mm for both first and subsequent layers. Verify printer bed exclusions, brim space and sliced colors before printing. This file contains geometry, not G-code.</p><p class="hint">${m.plates > 1 ? 'The ZIP contains one 3MF per plate. Open and print them separately.' : '3MF preserves millimeters, geometry and color-part assignments.'}</p>`);
    preview.innerHTML = `<h3>Final plate preview</h3>${select('plate', 'Plate', Array.from({ length: m.plates }, (_, i) => [String(i), `Plate ${i + 1}`]), String(plate))}<div id="iw-viewer" class="iw-viewer"></div><p class="iw-legend">Drag to rotate · scroll to zoom. Piece orientation is preserved during packing.</p>`;
    actions(true, m.plates > 1 ? 'Download plate ZIP' : 'Download multicolor 3MF', 'download'); showViewer(m);
    listen('plate', 'change', () => { plate = +val('plate'); showViewer(m); });
    controls.querySelector('.iw-actions')!.insertAdjacentHTML('beforeend', '<button type="button" id="iw-download-obj" class="secondary" data-work>Download OBJ + MTL ZIP</button>');
    status('Model verified. Ready to download.');
    async function download(format: '3mf' | 'obj') {
      if (busy) return; const data = await run({ action: 'export', format, model: m }); if (!data) return;
      const r = data.result, blob = new Blob([r.bytes], { type: r.type }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); status('Download created.');
    }
    listen('download', 'click', () => { void download('3mf'); });
    listen('download-obj', 'click', () => { void download('obj'); });
  }
  $('close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { disposed = true; stop(); disposeViewer?.(); image?.close(); dialog.remove(); }, { once: true });
  render(); dialog.showModal();
}
