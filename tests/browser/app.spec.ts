import { test, expect } from '@playwright/test';

test('seam curvature works independently of locked grid jitter and survives refresh',async({page})=>{
  await page.goto('./');await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#jitter')).toBeDisabled();await expect(page.locator('#seamCurvature')).toBeEnabled();
  await page.locator('#tabStyle').selectOption('none');await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  const straight=await page.locator('#drawing').innerHTML();
  await page.locator('[data-slider="seamCurvature"]').fill('2');await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#seamCurvature')).toHaveValue('2');expect(await page.locator('#drawing').innerHTML()).not.toBe(straight);
  await expect(page.locator('#curve-hint')).toContainText('Actual bend');
  await page.locator('#colors').uncheck();await page.screenshot({path:'artifacts/curved-seams.png',fullPage:true});
  await page.locator('#exportMode').selectOption('mask');await expect(page.locator('#download')).toBeEnabled();
  await page.reload();await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#seamCurvature')).toHaveValue('2');
  await page.locator('[data-reset="seamCurvature"]').click();await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#seamCurvature')).toHaveValue('0');
});

test('tab sliders follow geometry and allow larger rounded tabs',async({page})=>{
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('[data-count="4"]').click(); await page.locator('#width').fill('31'); await page.locator('#height').fill('31');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('[data-slider="tabSize"]')).toHaveAttribute('max','3.64');
  await page.locator('#tabStyle').selectOption('jigsaw'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('[data-slider="tabSize"]')).toHaveAttribute('max','5.2');
  await page.locator('[data-slider="tabSize"]').fill('5');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#tabSize')).toHaveValue('5'); await expect(page.locator('#stat-tabs')).toContainText('5.00');
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#tab-limit-hint')).toContainText('5.20 mm');
  await page.locator('#width').fill('62'); await page.locator('#height').fill('62');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('[data-slider="tabSize"]')).toHaveAttribute('max','10.4');
  await page.locator('#randomTabs').check();
  await expect(page.locator('[data-slider="tabMin"]')).toHaveAttribute('max','10.4');
  await expect(page.locator('[data-slider="tabMax"]')).toHaveAttribute('max','10.4');
  await page.screenshot({path:'artifacts/tab-limits.png',fullPage:true});
});

test('Bambu cutting mask exports gap fills, preserves holes, and rejects zero width', async ({page})=>{
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#exportColors').check(); await page.locator('#exportLabels').check();
  await page.locator('#exportMode').selectOption('mask');
  await expect(page.locator('#view-mask')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.mask-preview')).toBeVisible();
  await expect(page.locator('#mode-note')).toContainText('Red = material removed');
  await expect(page.locator('#exportColors')).toBeDisabled(); await expect(page.locator('#exportLabels')).toBeDisabled();
  await expect(page.locator('#strokeWidth')).toBeDisabled();
  await page.screenshot({path:'artifacts/cutting-mask.png',fullPage:true});
  const pending=page.waitForEvent('download'); await page.locator('#download').click(); const download=await pending;
  expect(download.suggestedFilename()).toContain('cutting-mask.svg');
  const stream=await download.createReadStream(); let content=''; for await(const c of stream!) content+=c;
  const geometry=await page.evaluate(svg=>{
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
    const path=doc.querySelector('path')!;
    // A real SVG fill hit-test verifies holes are empty, not white paint over a solid rectangle.
    const holder=document.createElementNS('http://www.w3.org/2000/svg','svg');
    holder.appendChild(document.importNode(path,true)); document.body.appendChild(holder);
    const shape=holder.firstChild as SVGGeometryElement;
    const point=(x:number,y:number)=>shape.isPointInFill(new DOMPoint(x,y));
    const result={errors:doc.querySelectorAll('parsererror').length,paths:doc.querySelectorAll('path').length,stroke:path.getAttribute('stroke'),pieceCenter:point(20,16),gap:point(40,10)};
    holder.remove(); return result;
  },content);
  expect(geometry).toEqual({errors:0,paths:1,stroke:'none',pieceCenter:false,gap:true});
  expect(content).not.toContain('<text'); expect(content).not.toContain('fill="#ffffff"');
  await page.locator('#clearance').fill('0'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#download')).toBeDisabled(); await expect(page.locator('#export-hint')).toContainText('greater than 0');
  await page.locator('#clearance').fill('0.2'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#download')).toBeEnabled();
  await page.reload(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#exportMode')).toHaveValue('mask');
});
test('custom fit values persist, exact gaps highlight failures, and SVG colors match', async ({page}) => {
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#customFits').check();
  await page.locator('#fitSuperTight').fill('0.07'); await page.locator('#fitTight').fill('0.21'); await page.locator('#fitLoose').fill('0.42');
  await page.locator('[data-fit="0.15"]').click(); await expect(page.locator('#clearance')).toHaveValue('0.21');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.reload(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#customFits')).toBeChecked(); await expect(page.locator('#fitLoose')).toHaveValue('0.42');
  await page.locator('#autoClearance').uncheck(); await page.locator('#width').fill('30'); await page.locator('#height').fill('30'); await page.locator('#clearance').fill('3');
  await expect(page.locator('#status-text')).toHaveText('Settings need attention');
  await expect(page.locator('#clearance')).toHaveValue('3'); await expect(page.locator('#clearance')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('.problematic-cell').first()).toBeVisible(); await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#mode-note')).toContainText('Invalid draft');
  await page.screenshot({path:'artifacts/problem-cells.png',fullPage:true});
  await page.locator('#clearance').fill('0.02'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('.problematic-cell')).toHaveCount(0); await expect(page.locator('#clearance')).not.toHaveAttribute('aria-invalid','true');
  const pending=page.waitForEvent('download'); await page.locator('#download').click(); const d=await pending;
  const stream=await d.createReadStream(); let content=''; for await(const chunk of stream!) content+=chunk;
  const colors=await page.evaluate(svg=>{
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
    return {fills:[...doc.querySelectorAll('path')].map(p=>p.getAttribute('fill')),stroke:doc.querySelector('#piece-outlines')?.getAttribute('stroke')};
  },content);
  expect(new Set(colors.fills)).toEqual(new Set(['#ffffff'])); expect(colors.stroke).toBe('#000000');
  expect(content).not.toContain('problematic-cell'); expect(content).not.toContain('#f18a82');
});
test('local app: live controls, matching exports, errors and mobile layout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#stat-count')).toHaveText('25');
  await expect(page.locator('#distribution')).toBeDisabled();
  await page.screenshot({ path: 'artifacts/workshop-desktop.png', fullPage: true });
  const original = await page.locator('#drawing').innerHTML();
  await page.locator('#colors').uncheck(); await page.locator('#numbers').check();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('200x160mm-foundry-2026-tab-4mm-fit-0.2mm-piece-outlines.svg');
  const stream = await download.createReadStream(); let content = ''; for await (const chunk of stream!) content += chunk;
  expect(content).not.toContain('<text'); expect(content).not.toContain('<image');
  const parsed = await page.evaluate(svg => { const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { errors: doc.querySelectorAll('parsererror').length, width: doc.documentElement.getAttribute('width'), paths: [...doc.querySelectorAll('path')].map(p => p.getAttribute('d')) }; }, content);
  expect(parsed.errors).toBe(0); expect(parsed.width).toBe('200mm'); expect(parsed.paths.length).toBe(25);
  for (const path of parsed.paths) expect(path).toMatch(/ Z$/);
  await page.locator('#zoom-in').click(); await expect(page.locator('#zoom-value')).toHaveText('125%');
  await page.locator('#fit').click(); await expect(page.locator('#zoom-value')).toHaveText('100%');
  await page.locator('#width').fill('10'); await page.locator('#height').fill('10'); await page.locator('[data-count="100"]').click();
  await expect(page.locator('#error')).toBeVisible(); await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('.problematic-cell').first()).toBeVisible();
  await expect(page.locator('#error')).toContainText('last valid pattern is retained');
  await page.locator('#width').fill('200'); await page.locator('#height').fill('160'); await page.locator('[data-count="25"]').click();
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#colors').check(); await page.locator('#numbers').uncheck();
  expect(await page.locator('#drawing').innerHTML()).toBe(original);
  await page.locator('#geometry').selectOption('voronoi'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#distribution')).toBeEnabled();
  await page.locator('#distribution').selectOption('poisson'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#jitter')).toBeDisabled();
  await page.locator('#view-pieces').click(); await expect(page.locator('#mode-note')).toContainText('0.2 mm');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/workshop-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('#preview')).toBeVisible(); expect(errors).toEqual([]);
  await page.context().setOffline(true);
  await page.locator('#new-seed').click(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#download')).toBeEnabled(); await page.context().setOffline(false);
});

test('presets persist and support rename, update, duplicate, import and delete', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#preset-name').fill('My saved puzzle'); await page.locator('#save-preset').click();
  await expect(page.locator('#preset-select option:checked')).toHaveText('My saved puzzle');
  await page.reload(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#preset-select')).toContainText('My saved puzzle');
  await page.locator('#preset-select').selectOption({ label: 'My saved puzzle' });
  await page.locator('#preset-name').fill('Renamed puzzle'); await page.locator('#rename-preset').click();
  await expect(page.locator('#preset-select option:checked')).toHaveText('Renamed puzzle');
  await page.locator('#seed').fill('preset-updated'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#exportColors').check(); await page.locator('#update-preset').click();
  await page.locator('#seed').fill('discard-this'); await page.locator('#load-preset').click();
  await expect(page.locator('#seed')).toHaveValue('preset-updated'); await expect(page.locator('#exportColors')).toBeChecked();
  await page.locator('#duplicate-preset').click(); await expect(page.locator('#preset-select option:checked')).toHaveText('Renamed puzzle (copy)');
  const dp = page.waitForEvent('download'); await page.locator('#export-presets').click(); const download = await dp;
  const stream = await download.createReadStream(); let json = ''; for await (const chunk of stream!) json += chunk;
  const data = JSON.parse(json); expect(data.presets.length).toBe(5); expect(data.presets[3].settings.seed).toBe('preset-updated');
  await page.locator('#preset-file').setInputFiles({ name: 'presets.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#preset-select option')).toHaveCount(10);
  await page.locator('#delete-preset').click(); await expect(page.locator('#preset-select option')).toHaveCount(9);
  await page.reload(); await expect(page.locator('#preset-select option')).toHaveCount(9);
});

test('aspect lock, custom rows, random sizes and both SVG modes', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#aspectLock').check(); await page.locator('#width').fill('300');
  await expect(page.locator('#height')).toHaveValue('240'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#width').fill(''); await expect(page.locator('#error')).toBeVisible();
  await page.locator('#width').fill('300'); await expect(page.locator('#height')).toHaveValue('240');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#gridMode').selectOption('manual'); await page.locator('#rows').fill('3'); await page.locator('#columns').fill('4');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready'); await expect(page.locator('#stat-count')).toHaveText('12');
  await page.locator('#randomTabs').check(); await page.locator('#tabMin').fill('1.5'); await page.locator('#tabMax').fill('2.5');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#strokeWidth').fill('0'); await expect(page.locator('#error')).toBeVisible();
  await page.locator('#strokeWidth').fill('0.5'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#exportMode').selectOption('cut');
  const dp = page.waitForEvent('download'); await page.locator('#download').click(); const d = await dp;
  const stream = await d.createReadStream(); let svg = ''; for await (const chunk of stream!) svg += chunk;
  expect(svg).toContain('width="300mm" height="240mm" viewBox="0 0 300 240"');
  expect(svg).toContain('stroke-width="0.5"');
  expect([...svg.matchAll(/id="edge-\d+"/g)].length).toBe(17);
  expect(svg).not.toContain('id="piece-');
});

test('rounded jigsaw tabs export and persist with a high-contrast monochrome preview', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#tabStyle').selectOption('jigsaw');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await page.locator('#colors').uncheck(); await page.locator('#numbers').check();
  for (const mode of ['cut', 'pieces']) {
    await page.locator(`#view-${mode}`).click();
    const colors = await page.locator('#drawing').evaluate(drawing => ({
      fills: [...drawing.querySelectorAll('.piece-fill')].map(p => getComputedStyle(p).fill),
      cuts: [...drawing.querySelectorAll('.preview-cut-lines, .piece-fill[stroke]:not([stroke="none"])')].map(p => getComputedStyle(p).stroke),
      labels: [...drawing.querySelectorAll('.piece-number')].map(p => getComputedStyle(p).fill),
    }));
    expect(colors.fills.length).toBe(25); expect(new Set(colors.fills)).toEqual(new Set(['rgb(255, 255, 255)']));
    expect(colors.cuts.length).toBeGreaterThan(0); expect(new Set(colors.cuts)).toEqual(new Set(['rgb(0, 0, 0)']));
    expect(colors.labels.length).toBe(25); expect(new Set(colors.labels)).toEqual(new Set(['rgb(0, 0, 0)']));
  }
  await page.locator('#view-cut').click(); await page.locator('#numbers').uncheck();
  await page.screenshot({ path: 'artifacts/jigsaw-monochrome.png', fullPage: true });
  for (const mode of ['pieces', 'cut']) {
    await page.locator('#exportMode').selectOption(mode);
    const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
    const stream = await download.createReadStream(); let svg = ''; for await (const chunk of stream!) svg += chunk;
    const result = await page.evaluate(content => {
      const doc = new DOMParser().parseFromString(content, 'image/svg+xml');
      return { errors: doc.querySelectorAll('parsererror').length, settings: JSON.parse(doc.querySelector('metadata')!.textContent!).settings, ids: [...doc.querySelectorAll('path')].map(p => p.id) };
    }, svg);
    expect(result.errors).toBe(0); expect(result.settings.tabStyle).toBe('jigsaw');
    expect(result.settings.colors).toBe(false);
    expect(result.ids.length).toBe(mode === 'pieces' ? 25 : 41);
  }
  await page.reload(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#tabStyle')).toHaveValue('jigsaw'); await expect(page.locator('#colors')).not.toBeChecked();
  await page.locator('#colors').check();
  const fills = await page.locator('.piece-fill').evaluateAll(paths => paths.map(p => getComputedStyle(p).fill));
  expect(new Set(fills).size).toBeGreaterThan(1);
});

test('numeric sliders, individual resets, fit suggestions and small-pattern clearance', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  expect(await page.locator('[data-slider]').count()).toBe(await page.locator('input[type=number][data-setting]').count());
  await page.locator('#width').fill('30'); await page.locator('#height').fill('30');
  await page.locator('#clearance').fill('3');
  await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#warning')).toContainText('Clearance adjusted');
  const gap = Number(await page.locator('#clearance').inputValue());
  expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThan(3);
  await expect(page.locator('[data-slider="clearance"]')).toHaveValue(String(gap));
  await page.locator('[data-fit="0.05"]').click(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  expect(Number(await page.locator('#clearance').inputValue())).toBeLessThanOrEqual(.05);
  await page.locator('[data-slider="strokeWidth"]').fill('0.5'); await expect(page.locator('#strokeWidth')).toHaveValue('0.5');
  await page.locator('[data-reset="strokeWidth"]').click(); await expect(page.locator('#strokeWidth')).toHaveValue('0.25');
  await page.locator('[data-reset="width"]').click(); await expect(page.locator('#width')).toHaveValue('200');
  await page.locator('[data-reset="height"]').click(); await expect(page.locator('#height')).toHaveValue('160');
  await page.locator('[data-reset="clearance"]').click(); await expect(page.locator('#status-text')).toHaveText('Geometry ready');
  await expect(page.locator('#clearance')).toHaveValue('0.2');
  await expect(page.locator('[data-slider="rows"]')).toBeDisabled();
  await page.locator('#colors').uncheck();
  await page.screenshot({ path:'artifacts/numeric-controls.png', fullPage:true });
});
