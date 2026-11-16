import libtess from 'libtess';
const { GluTesselator, gluEnum, primitiveType, windingRule } = libtess;
import { area, booleanPaths, type Pattern, type Point } from './geometry';

export interface Raster { width: number; height: number; labels: Uint8Array }
export interface Mesh { vertices: number[]; triangles: number[] }
export interface Solid { mesh: Mesh; slot: number; name: string }
export interface ModelPiece { id: number; solids: Solid[]; bounds: Bounds; x: number; y: number; plate: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface Model { pieces: ModelPiece[]; plates: number; width: number; height: number; layer: number; nozzle: number; clearance: number; exploded: boolean; spacing: number; palette: string[]; backing: number }
export { basicSwatches, rgb, nearest, detectPalette, rasterSize, mapRaster } from './image-colors';
// Merge identical horizontal runs vertically before polygon union; this preserves every classified pixel.
export function colorRegions(r: Raster, width: number, height: number): Point[][][] {
  const rects: Bounds[][] = [[], [], [], []]; let active = new Map<string, Bounds>();
  for (let y = 0; y < r.height; y++) {
    const next = new Map<string, Bounds>();
    for (let x = 0; x < r.width;) {
      const start = x, color = r.labels[y * r.width + x];
      while (x < r.width && r.labels[y * r.width + x] === color) x++;
      const key = `${color}:${start}:${x}`, prior = active.get(key);
      const rect = prior || { x: start, y, width: x - start, height: 0 };
      if (!prior) rects[color].push(rect); rect.height++; next.set(key, rect);
    }
    active = next;
  }
  return rects.map(rects => booleanPaths(rects.map(b => {
    const x = b.x * width / r.width, y = b.y * height / r.height, xx = (b.x + b.width) * width / r.width, yy = (b.y + b.height) * height / r.height;
    return [[x, y], [xx, y], [xx, yy], [x, yy]];
  }), [], 'union'));
}
export function bounds(points: Point[]): Bounds {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys); return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
// Tessellation may remove collinear boundary vertices. Split cap
// edges at all collinear cap endpoints so side walls and caps use identical edges.
function conformingCap(points: Point[], triangles: number[]) {
  const lines = new Map<string, Set<number>>();
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const lineKey = (a: number, b: number) => {
    const [x, y] = points[a].map(v => Math.round(v * 100000)), [xx, yy] = points[b].map(v => Math.round(v * 100000));
    let dx = xx - x, dy = yy - y; const g = gcd(Math.abs(dx), Math.abs(dy));
    if (!g) return '';
    dx /= g; dy /= g; if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
    return `${dx},${dy},${dy * x - dx * y}`;
  };
  const clean: number[][] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    let [a, b, c] = triangles.slice(i, i + 3);
    const cross = (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) - (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]);
    if (Math.abs(cross) < 1e-12) continue; if (cross < 0) [b, c] = [c, b];
    const tri = [a, b, c]; clean.push(tri);
    for (let j = 0; j < 3; j++) { const a = tri[j], b = tri[(j + 1) % 3], key = lineKey(a, b), set = lines.get(key) || new Set<number>(); set.add(a); set.add(b); lines.set(key, set); }
  }
  const result: number[] = [];
  for (const tri of clean) {
    const perimeter: number[] = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], pa = points[a], pb = points[b], axis = Math.abs(pb[0] - pa[0]) > Math.abs(pb[1] - pa[1]) ? 0 : 1;
      const mid = [...lines.get(lineKey(a, b))!].map(i => ({ i, t: (points[i][axis] - pa[axis]) / (pb[axis] - pa[axis]) })).filter(v => v.t > 1e-9 && v.t < 1 - 1e-9).sort((a, b) => a.t - b.t);
      perimeter.push(a); let prior = -1;
      for (const v of mid) if (Math.abs(v.t - prior) > 1e-9) { perimeter.push(v.i); prior = v.t; }
    }
    if (perimeter.length === 3) result.push(...tri);
    else {
      const center = points.length; points.push([tri.reduce((n, i) => n + points[i][0], 0) / 3, tri.reduce((n, i) => n + points[i][1], 0) / 3]);
      for (let j = 0; j < perimeter.length; j++) result.push(center, perimeter[j], perimeter[(j + 1) % perimeter.length]);
    }
  }
  return result;
}
// Duplicate a planar vertex for disconnected triangle fans. Diagonal raster
// islands can touch at a coordinate, but must not share a non-manifold vertical edge.
function splitCapFans(points: Point[], triangles: number[]) {
  const parent = triangles.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number) => { parent[root(a)] = root(b); };
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < triangles.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = i + j, b = i + (j + 1) % 3, va = triangles[a], vb = triangles[b], key = va < vb ? `${va}:${vb}` : `${vb}:${va}`;
    const prior = edges.get(key);
    if (prior) { if (triangles[prior[0]] === va) { join(a, prior[0]); join(b, prior[1]); } else { join(a, prior[1]); join(b, prior[0]); } }
    else edges.set(key, [a, b]);
  }
  const newPoints: Point[] = [], ids = new Map<number, number>();
  const newTriangles = triangles.map((v, i) => { const r = root(i); let id = ids.get(r); if (id === undefined) { id = newPoints.length; ids.set(r, id); newPoints.push(points[v]); } return id; });
  return { points: newPoints, triangles: newTriangles };
}
export function extrude(paths: Point[][], z0: number, z1: number): Mesh {
  const mesh: Mesh = { vertices: [], triangles: [] };
  const points: Point[] = [], indices = new Map<string, number>(), triangles: number[] = [];
  const tess = new GluTesselator();
  tess.gluTessNormal(0, 0, 1);
  tess.gluTessProperty(gluEnum.GLU_TESS_WINDING_RULE, windingRule.GLU_TESS_WINDING_NONZERO);
  tess.gluTessCallback(gluEnum.GLU_TESS_BEGIN, (type: number) => { if (type !== primitiveType.GL_TRIANGLES) throw new Error('Unexpected tessellation primitive.'); });
  tess.gluTessCallback(gluEnum.GLU_TESS_EDGE_FLAG, () => {});
  tess.gluTessCallback(gluEnum.GLU_TESS_ERROR, (code: number) => { throw new Error(`Color tessellation failed (${code}).`); });
  tess.gluTessCallback(gluEnum.GLU_TESS_COMBINE, (coords: number[]) => coords);
  tess.gluTessCallback(gluEnum.GLU_TESS_VERTEX, (p: number[]) => {
    const key = `${p[0]},${p[1]}`; let i = indices.get(key);
    if (i === undefined) { i = points.length; indices.set(key, i); points.push([p[0], p[1]]); }
    triangles.push(i);
  });
  tess.gluTessBeginPolygon(null);
  for (const path of paths) {
    tess.gluTessBeginContour(); for (const [x, y] of path) { const p: [number, number, number] = [x, y, 0]; tess.gluTessVertex(p, p); } tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon(); tess.gluDeleteTess();
  {
    const cap = splitCapFans(points, conformingCap(points, triangles)), tris = cap.triangles, base = 0;
    const n = cap.points.length;
    for (const z of [z0, z1]) for (const [x, y] of cap.points) mesh.vertices.push(x, -y, z);
    const boundary = new Map<string, { a: number; b: number; count: number }>();
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = tris.slice(i, i + 3);
      mesh.triangles.push(base + a, base + b, base + c, base + n + a, base + n + c, base + n + b);
      for (const [a, b] of [[tris[i], tris[i + 1]], [tris[i + 1], tris[i + 2]], [tris[i + 2], tris[i]]]) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const edge = boundary.get(key); if (edge) edge.count++; else boundary.set(key, { a, b, count: 1 });
      }
    }
    for (const edge of boundary.values()) if (edge.count === 1) {
      const a = base + edge.a, b = base + edge.b;
      mesh.triangles.push(a, a + n, b + n, a, b + n, b);
    }
  }
  return mesh;
}
export function meshVolume(m: Mesh) {
  let volume = 0; const v = m.vertices;
  for (let i = 0; i < m.triangles.length; i += 3) {
    const [a, b, c] = m.triangles.slice(i, i + 3).map(i => i * 3);
    volume += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return volume / 6;
}
export function verifyMesh(m: Mesh) {
  if (!m.triangles.length || m.vertices.some(v => !Number.isFinite(v))) throw new Error('An empty or invalid mesh was generated.');
  const edges = new Map<string, { count: number; direction: number }>();
  for (let i = 0; i < m.triangles.length; i += 3) {
    const tri = m.triangles.slice(i, i + 3);
    if (tri.some(v => !Number.isInteger(v) || v < 0 || v * 3 >= m.vertices.length)) throw new Error('Invalid mesh index.');
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3]; if (a === b) throw new Error('Degenerate mesh edge.');
      const k = a < b ? `${a}|${b}` : `${b}|${a}`, edge = edges.get(k) || { count: 0, direction: 0 };
      edge.count++; edge.direction += a < b ? 1 : -1; edges.set(k, edge);
    }
  }
  if ([...edges.values()].some(v => v.count !== 2 || v.direction !== 0) || meshVolume(m) <= 0) throw new Error('Mesh validation failed: an open boundary or reversed volume was found.');
}
export function packPieces(pieces: ModelPiece[], bed: number, gap: number, exploded: boolean, height: number) {
  if (!exploded) { for (const p of pieces) { p.x = p.bounds.x; p.y = height - p.bounds.y - p.bounds.height; p.plate = 0; } return 1; }
  // Non-rotating shelf packing with a full gap between bounding boxes (therefore between all outlines).
  const plates: { x: number; y: number; row: number }[] = [];
  for (const p of [...pieces].sort((a, b) => b.bounds.height - a.bounds.height || a.id - b.id)) {
    const w = p.bounds.width, h = p.bounds.height;
    if (w > bed + 1e-5 || h > bed + 1e-5) throw new Error(`Piece ${p.id + 1} exceeds the ${bed} mm plate. Choose more pieces or a smaller model.`);
    let placed = false;
    for (let i = 0; i <= plates.length; i++) {
      const shelf = plates[i] || { x: 0, y: 0, row: 0 };
      let x = shelf.x, y = shelf.y, row = shelf.row;
      if (x + w > bed + 1e-5) { x = 0; y += row + gap; row = 0; }
      if (y + h > bed + 1e-5) continue;
      p.x = x; p.y = y; p.plate = i;
      plates[i] = { x: x + w + gap, y, row: Math.max(row, h) }; placed = true; break;
    }
    if (!placed) throw new Error('Plate packing failed.');
  }
  return plates.length;
}
export function buildModel(raster: Raster, pattern: Pattern, palette: string[], backing: number, nozzle: number, exploded: boolean, bed = 256): Model {
  const { width, height, clearance } = pattern.settings, layer = nozzle === .2 ? .1 : .2;
  if (palette.length !== 4 || !Number.isInteger(backing) || backing < 0 || backing > 3 || ![.2, .4].includes(nozzle)) throw new Error('Invalid model options.');
  const regions = colorRegions(raster, width, height), pieces: ModelPiece[] = [];
  for (const p of pattern.pieces) {
    const b = bounds(p.outline), solids: Solid[] = [];
    const backingMesh = extrude([p.outline], 0, 7 * layer);
    solids.push({ mesh: backingMesh, slot: backing, name: 'Backing · 7 layers' });
    for (let slot = 0; slot < 4; slot++) {
      const clipped = booleanPaths(regions[slot], [p.outline], 'intersection');
      if (!clipped.length) continue;
      solids.push({ mesh: extrude(clipped, 7 * layer, 10 * layer), slot, name: `Image · AMS ${slot + 1} · 3 layers` });
    }
    const expectedArea = Math.abs(area(p.outline));
    let topVolume = 0;
    for (const s of solids) { verifyMesh(s.mesh); if (s !== solids[0]) topVolume += meshVolume(s.mesh); }
    if (Math.abs(topVolume - expectedArea * 3 * layer) > Math.max(.02, expectedArea * .0001)) throw new Error('Color coverage check failed. Try a different crop or nozzle.');
    pieces.push({ id: p.id, solids, bounds: b, x: 0, y: 0, plate: 0 });
  }
  const spacing = exploded ? 2 + clearance : 0;
  const plates = packPieces(pieces, bed, spacing, exploded, height);
  return { pieces, plates, width, height, layer, nozzle, clearance, exploded, spacing, palette, backing };
}
export { positionedVertices } from './image-placement';
