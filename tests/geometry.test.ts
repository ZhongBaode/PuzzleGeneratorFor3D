import { test } from 'node:test';
import assert from 'node:assert/strict';
import { area, booleanPaths, generate, generateWithClearance, GeometryIssue, isSimple, poissonPoints, seededRandom } from '../src/geometry';
import { defaults, starterPresets, validateSettings } from '../src/settings';
import { cuttingMask, exportSvg, pathData, svgFilename } from '../src/svg';
import { parsePresets } from '../src/presets';

test('target piece size calculates count, preserves dimensions, and rejects excessive grids', () => {
  for (const geometry of ['rectangular', 'voronoi'] as const) for (const distribution of ['grid', 'poisson'] as const) {
    const s = { ...defaults, sizingMode: 'size' as const, pieceSize: 40, width: 200, height: 160, geometry, distribution, tabStyle: 'none' as const };
    const p = generate(s);
    assert.equal(p.pieces.length, 20);
    assert.equal(p.settings.count, 20);
    assert.equal(p.settings.width, 200); assert.equal(p.settings.height, 160);
    assert.deepEqual(p.edges, generate(s).edges);
  }
  const p = generate({ ...defaults, sizingMode: 'size', pieceSize: 31, width: 100, height: 80, tabStyle: 'none' });
  assert.equal(p.columns, 3); assert.equal(p.rows, 3); assert.equal(p.pieces.length, 9);
  assert.throws(() => validateSettings({ ...defaults, sizingMode: 'size', pieceSize: 1 }), /at most 200/);
  assert.equal(validateSettings({ ...defaults, sizingMode: 'size', pieceSize: 2000 }).count, 1);
  const restored = parsePresets({ version: 1, presets: [{ id: 'size-test', name: 'Size test', settings: p.settings }] });
  assert.equal(restored[0].settings.pieceSize, 31); assert.equal(restored[0].settings.sizingMode, 'size');
});

test('curved shared seams stay reproducible, complementary, clipped and exportable',()=>{
  for(const base of [defaults,starterPresets[1].settings,starterPresets[2].settings])for(const tabStyle of ['none','jigsaw'] as const){
    const s={...base,count:9,tabStyle,seamCurvature:2};
    const p=generate(s),repeat=generate(s);
    assert.deepEqual(p.edges,repeat.edges); assert.ok(p.maxCurve>0);
    for(const e of p.edges){
      if(e.cells.length===1){assert.equal(e.points.length,2);assert.equal(e.curvature,0);continue;}
      assert.ok(e.points.length>2);
      const forward=e.points.map(v=>v.join(',')).join('|'), reverse=[...e.points].reverse().map(v=>v.join(',')).join('|');
      const [a,b]=e.cells.map(id=>{const points=p.pieces[id].nominal;return [...points,...points].map(v=>v.join(',')).join('|');});
      assert.ok(a.includes(forward)&&b.includes(reverse)||a.includes(reverse)&&b.includes(forward));
    }
    for(const piece of p.pieces){
      assert.ok(isSimple(piece.nominal));assert.ok(isSimple(piece.outline));
      for(const [x,y]of piece.nominal)assert.ok(x>=0&&y>=0&&x<=s.width&&y<=s.height);
    }
    for(let i=0;i<p.pieces.length;i++)for(let j=i+1;j<p.pieces.length;j++)assert.ok(booleanPaths([p.pieces[i].nominal],[p.pieces[j].nominal],'intersection').reduce((n,v)=>n+Math.abs(area(v)),0)<.001);
    const kept=booleanPaths([[[0,0],[s.width,0],[s.width,s.height],[0,s.height]]],cuttingMask(p),'difference');
    assert.ok(Math.abs(kept.reduce((n,v)=>n+area(v),0)-p.pieces.reduce((n,v)=>n+Math.abs(area(v.outline)),0))<.001);
    assert.deepEqual(parsePresets({version:1,presets:[{id:'curves',name:'Curves',settings:s}]})[0].settings,s);
  }
  const p=generate({...defaults,width:31,height:31,count:4,seamCurvature:20});
  assert.ok(p.maxCurve>0&&p.maxCurve<20);assert.ok(p.warnings.some(w=>w.includes('seam bends limited')));
  const straight=generate({...defaults,tabStyle:'none',seamCurvature:0});
  for(const e of straight.edges)assert.equal(e.points.length,2);
});

test('31 mm four-piece tabs grow beyond the old cap without overlap', () => {
  for (const [tabStyle, limit] of [['rectangular',3.64], ['jigsaw',5.2], ['triangular',5.6]] as const) {
    const p=generate({...defaults,width:31,height:31,count:4,tabStyle,tabSize:100});
    assert.equal(p.tabCapacity.max,limit); assert.equal(p.tabCapacity.min,limit);
    assert.ok(p.maxTab > 2.48);
    for (const piece of p.pieces) {
      assert.ok(isSimple(piece.nominal)); assert.ok(isSimple(piece.outline));
      for (const [x,y] of piece.nominal) assert.ok(x>=0 && y>=0 && x<=31 && y<=31);
    }
    for(let i=0;i<p.pieces.length;i++)for(let j=i+1;j<p.pieces.length;j++) {
      const overlap=booleanPaths([p.pieces[i].nominal],[p.pieces[j].nominal],'intersection');
      assert.ok(overlap.reduce((n,v)=>n+Math.abs(area(v)),0)<.001);
    }
  }
  const small=generate({...defaults,width:31,height:31,count:4,tabStyle:'jigsaw',tabSize:2});
  const large=generate({...defaults,width:62,height:62,count:4,tabStyle:'jigsaw',tabSize:2});
  assert.ok(large.tabCapacity.max>small.tabCapacity.max);
});

test('Bambu cutting mask removes only clearance and subtraction preserves every piece', () => {
  for (const settings of [defaults, {...defaults,tabStyle:'jigsaw' as const}, starterPresets[1].settings, starterPresets[2].settings]) {
    const p = generate({...settings,exportMode:'mask',exportColors:true,exportLabels:true});
    const mask = cuttingMask(p);
    const rectangle: [number,number][] = [[0,0],[p.settings.width,0],[p.settings.width,p.settings.height],[0,p.settings.height]];
    const kept = booleanPaths([rectangle],mask,'difference');
    const expected = p.pieces.map(piece=>piece.outline);
    const deviation = [...booleanPaths(kept,expected,'difference'),...booleanPaths(expected,kept,'difference')].reduce((n,p)=>n+Math.abs(area(p)),0);
    assert.ok(deviation < .001, `Subtraction changed kept geometry by ${deviation} mm²`);
    for (const piece of p.pieces) assert.ok(booleanPaths([piece.outline],mask,'intersection').reduce((n,p)=>n+Math.abs(area(p)),0)<.001);
    const svg=exportSvg(p);
    assert.equal([...svg.matchAll(/<path /g)].length,1);
    assert.ok(svg.includes('id="cutting-mask"')); assert.ok(svg.includes('fill-rule="evenodd" stroke="none"'));
    assert.ok(!svg.includes('<text')); assert.ok(!svg.includes('id="boundary"')); assert.ok(!svg.includes('fill="#ffffff"'));
    assert.ok(svgFilename(p).endsWith('cutting-mask.svg'));
    assert.deepEqual(parsePresets({version:1,presets:[{id:'mask',name:'Cutter',settings:p.settings}]})[0].settings,p.settings);
  }
  assert.throws(()=>cuttingMask(generate({...defaults,clearance:0})),/greater than 0/);
  assert.throws(()=>cuttingMask(generate({...defaults,count:1})),/at least two/);
});

test('exact clearance failures identify affected cells and custom fits persist', () => {
  assert.throws(() => generateWithClearance({ ...defaults, width:30, height:30, clearance:3, autoClearance:false }), error => {
    assert.ok(error instanceof GeometryIssue);
    assert.equal(error.diagnostic?.cells.length, 25);
    assert.ok(error.diagnostic!.affected.length > 0);
    assert.equal(error.diagnostic?.parameter, 'clearance');
    assert.equal(error.diagnostic?.width, 30);
    for (const id of error.diagnostic!.affected) assert.ok(id >= 0 && id < 25);
    return true;
  });
  const settings = {...defaults, customFits:true, fitSuperTight:.07, fitTight:.21, fitLoose:.42, autoClearance:false};
  const [preset] = parsePresets({version:1,presets:[{id:'custom',name:'Custom fits',settings}]});
  assert.deepEqual(preset.settings,settings);
  const svg = exportSvg(generate(defaults));
  assert.ok(svg.includes('stroke="#000000"'));
  const cut = exportSvg(generate({...defaults,exportMode:'cut'}));
  assert.ok(cut.includes('id="boundary" fill="#ffffff"'));
});

test('seeded generation reproduces all vertices, independent of unrelated calls', () => {
  const a = generate(defaults);
  generate({ ...defaults, seed: 'something-else' });
  const b = generate(defaults);
  assert.deepEqual(a.pieces, b.pieces);
  assert.deepEqual(a.edges, b.edges);
  assert.notDeepEqual(a.edges, generate({ ...defaults, seed: 'other' }).edges);
});

test('every seam is used once by each neighbor in opposite directions', () => {
  for (const tabStyle of ['rectangular', 'jigsaw'] as const) {
  const p = generate({ ...defaults, tabStyle, clearance: 0 });
  for (const edge of p.edges.filter(e => e.cells.length === 2)) {
    assert.equal(edge.cells.length, 2);
    assert.ok(edge.points.length > 2);
    assert.ok(edge.size > 0);
    const sequence = edge.points.map(v => v.join(',')).join('|');
    const reversed = [...edge.points].reverse().map(v => v.join(',')).join('|');
    const [a, b] = edge.cells.map(id => { const points = p.pieces[id].nominal; return [...points, ...points].map(v => v.join(',')).join('|'); });
    assert.ok(a.includes(sequence) && b.includes(reversed) || a.includes(reversed) && b.includes(sequence));
  }
  }
});

test('rounded jigsaw geometry is reproducible, closed, and non-overlapping in every layout', () => {
  for (const base of [defaults, starterPresets[1].settings, starterPresets[2].settings]) {
    const settings = { ...base, tabStyle: 'jigsaw' as const };
    const p = generate(settings);
    assert.deepEqual(p.edges, generate(settings).edges);
    for (const piece of p.pieces) {
      assert.ok(isSimple(piece.nominal)); assert.ok(isSimple(piece.outline));
      assert.ok(pathData(piece.outline).endsWith(' Z'));
      assert.ok(booleanPaths([piece.outline], [piece.nominal], 'difference').reduce((n, v) => n + Math.abs(area(v)), 0) < .0001);
    }
    for (let i = 0; i < p.pieces.length; i++) for (let j = i + 1; j < p.pieces.length; j++) {
      assert.ok(booleanPaths([p.pieces[i].nominal], [p.pieces[j].nominal], 'intersection').reduce((n, v) => n + Math.abs(area(v)), 0) < .005);
      assert.equal(booleanPaths([p.pieces[i].outline], [p.pieces[j].outline], 'intersection').length, 0);
    }
    for (const e of p.edges.filter(e => e.cells.length === 2)) assert.ok(e.points.length > 20);
    const piecesSvg = exportSvg(p);
    assert.equal([...piecesSvg.matchAll(/id="piece-\d+"/g)].length, p.pieces.length);
    assert.ok(piecesSvg.includes('&quot;tabStyle&quot;:&quot;jigsaw&quot;'));
    const cutSvg = exportSvg({ ...p, settings: { ...p.settings, exportMode: 'cut' } });
    assert.equal([...cutSvg.matchAll(/id="edge-\d+"/g)].length, p.edges.filter(e => e.cells.length === 2).length);
  }
  const p = generate({ ...defaults, tabStyle: 'jigsaw', randomTabs: true, tabMin: 2, tabMax: 3 });
  for (const e of p.edges.filter(e => e.cells.length === 2)) assert.ok(e.size >= 2 && e.size <= 3);
  const preset = { id: 'jigsaw', name: 'Classic jigsaw', settings: p.settings };
  assert.deepEqual(parsePresets(JSON.parse(JSON.stringify({ version: 1, presets: [preset] })))[0], preset);
  assert.throws(() => generate({ ...defaults, tabStyle: 'jigsaw', width: 10, height: 10, count: 100, clearance: 3 }), /short seam|Clearance/);
});

test('nominal pieces form a complete partition with no area overlap', () => {
  for (const s of [defaults, starterPresets[1].settings, starterPresets[2].settings, { ...defaults, geometry: 'voronoi' as const, tabStyle: 'none' as const, jitter: .7 }, { ...defaults, geometry: 'voronoi' as const, distribution: 'poisson' as const, tabStyle: 'none' as const }]) {
    const p = generate(s);
    for (const piece of p.pieces) {
      assert.ok(isSimple(piece.nominal)); assert.ok(isSimple(piece.outline));
      assert.ok(pathData(piece.outline).endsWith(' Z'));
      assert.ok(booleanPaths([piece.outline], [piece.nominal], 'difference').reduce((n, p) => n + Math.abs(area(p)), 0) < .0001);
    }
    for (let i = 0; i < p.pieces.length; i++) for (let j = i + 1; j < p.pieces.length; j++) {
      const overlap = booleanPaths([p.pieces[i].nominal], [p.pieces[j].nominal], 'intersection');
      assert.ok(overlap.reduce((s, v) => s + Math.abs(area(v)), 0) < .005);
      assert.equal(booleanPaths([p.pieces[i].outline], [p.pieces[j].outline], 'intersection').length, 0);
    }
  }
});

test('clearance is a geometric total gap, without shrinking the outer boundary', () => {
  const p = generate({ ...defaults, count: 2, gridMode: 'manual', rows: 1, columns: 2, tabStyle: 'none', clearance: .4 });
  const left = p.pieces[0].outline, right = p.pieces[1].outline;
  assert.equal(Math.max(...left.map(v => v[0])), 99.8);
  assert.equal(Math.min(...right.map(v => v[0])), 100.2);
  assert.equal(Math.min(...left.map(v => v[0])), 0);
  assert.equal(Math.max(...right.map(v => v[0])), 200);
  assert.equal(Math.max(...left.map(v => v[1])), 160);
});

test('small patterns adapt impossible clearances and export the actual gap', () => {
  for (const tabStyle of ['rectangular', 'jigsaw'] as const) {
    const p = generateWithClearance({ ...defaults, width: 30, height: 30, tabStyle, clearance: 3 });
    assert.equal(p.pieces.length, 25);
    assert.ok(p.settings.clearance >= 0 && p.settings.clearance < 3);
    assert.ok(p.warnings.some(w => w.includes('Clearance adjusted from 3')));
    for (const piece of p.pieces) assert.ok(isSimple(piece.outline));
    assert.ok(svgFilename(p).includes(`tab-4mm-fit-${p.settings.clearance}mm`));
    assert.deepEqual(generate(p.settings).pieces, p.pieces);
  }
  const large = generateWithClearance({ ...defaults, width: 300, height: 300, tabSize: 10, clearance: 3 });
  assert.equal(large.settings.clearance, 3);
  const random = generate({ ...defaults, randomTabs: true, tabMin: 2, tabMax: 3 });
  assert.ok(svgFilename(random).includes('tabs-2-3mm-fit-0.2mm'));
});

test('cut SVG includes each internal edge once and exact physical dimensions', () => {
  const p = generate({ ...defaults, exportMode: 'cut', seed: '<seed & "quoted">' });
  const svg = exportSvg(p);
  assert.ok(svg.includes('width="200mm" height="160mm" viewBox="0 0 200 160"'));
  assert.equal((svg.match(/id="boundary"/g) || []).length, 1);
  const ids = [...svg.matchAll(/id="(edge-\d+)"/g)].map(m => m[1]);
  assert.equal(ids.length, p.edges.filter(e => e.cells.length === 2).length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!svg.includes('<text')); assert.ok(!svg.includes('<image')); assert.ok(!svg.includes('color-'));
  assert.ok(svg.includes('&lt;seed &amp; &quot;quoted&quot;&gt;'));
  assert.ok(svgFilename(p).includes('200x160mm'));
});

test('piece SVG has one closed filled path per piece, no preview decorations', () => {
  const p = generate(defaults), svg = exportSvg(p);
  const paths = [...svg.matchAll(/<path id="piece-\d+" d="([^"]+)" fill="([^"]+)"/g)];
  assert.equal(paths.length, p.pieces.length);
  for (const path of paths) { assert.ok(path[1].endsWith(' Z')); assert.equal(path[2], '#ffffff'); }
  assert.ok(!svg.includes('<text'));
});

test('rectangular layout is preserved and actual count reported', () => {
  const p = generate({ ...defaults, count: 17, rows: 3, columns: 7, gridMode: 'manual' });
  assert.equal(p.pieces.length, 21); assert.equal(p.rows, 3); assert.equal(p.columns, 7);
  assert.ok(p.warnings.some(w => w.includes('Requested 17')));
  const a = generate({ ...defaults, count: 17 }); assert.equal(a.pieces.length, 20);
});

test('zero-jitter Voronoi produces a regular grid, and Poisson has exact count', () => {
  const p = generate({ ...defaults, geometry: 'voronoi', jitter: 0, clearance: 0, tabStyle: 'none' });
  assert.equal(p.pieces.length, 25);
  for (const piece of p.pieces) assert.ok(Math.abs(Math.abs(area(piece.nominal)) - 1280) < .001);
  const a = poissonPoints(31, 200, 160, seededRandom('poisson'));
  assert.equal(a.length, 31); assert.deepEqual(a, poissonPoints(31, 200, 160, seededRandom('poisson')));
  const min = Math.min(...a.flatMap((p, i) => a.slice(i + 1).map(q => Math.hypot(p[0] - q[0], p[1] - q[1]))));
  assert.ok(min > 10);
});

test('random depths are seeded and stay inside the requested range', () => {
  const s = { ...defaults, randomTabs: true, tabMin: 1.5, tabMax: 2.5 };
  const p = generate(s), q = generate(s);
  assert.deepEqual(p.edges, q.edges);
  for (const e of p.edges.filter(e => e.cells.length === 2)) assert.ok(e.size >= 1.5 && e.size <= 2.5);
  assert.throws(() => generate({ ...s, tabMin: 10, tabMax: 15 }), /minimum random tab size/);
});

test('large requests are safely capped and impossible small pieces fail usefully', () => {
  const p = generate({ ...defaults, tabSize: 100 }); assert.ok(p.warnings.length > 0);
  for (const piece of p.pieces) assert.ok(isSimple(piece.nominal));
  assert.throws(() => generate({ ...defaults, width: 10, height: 10, count: 100, clearance: 3 }), /short seam|Clearance/);
  assert.throws(() => validateSettings({ ...defaults, width: NaN }), /width/);
});

test('presets round-trip every generation and export setting', () => {
  const json = JSON.stringify({ version: 1, presets: starterPresets });
  assert.deepEqual(parsePresets(JSON.parse(json)), starterPresets);
  assert.throws(() => parsePresets({ version: 99, presets: [] }), /version 1/);
  assert.throws(() => parsePresets({ version: 1, presets: [{ ...starterPresets[0], settings: { ...defaults, width: -10 } }] }), /width/);
});

test('starter presets all generate usable pieces', () => {
  for (const p of starterPresets) assert.ok(generate(p.settings).pieces.length > 0, p.name);
});

test('geometry sweep: 120 seeded layouts either validate or report physical limits', () => {
  let valid = 0;
  for (let i = 0; i < 120; i++) {
    try {
      const p = generate({ ...defaults, seed: `sweep-${i}`, geometry: i % 3 ? 'voronoi' : 'rectangular', distribution: i % 2 ? 'poisson' : 'grid', count: [4, 9, 16, 25, 36, 64][i % 6], tabStyle: i % 2 ? 'triangular' : 'rectangular', tabSize: i % 4 ? 3 : 100, clearance: i % 3 * .1 });
      for (const piece of p.pieces) assert.ok(isSimple(piece.outline));
      valid++;
    } catch (error) {
      assert.match((error as Error).message, /short seam|minimum random|splits or erases|very short Voronoi/, `sweep-${i}: ${(error as Error).message}`);
    }
  }
  assert.ok(valid > 35, `Only ${valid} valid layouts`);
});
