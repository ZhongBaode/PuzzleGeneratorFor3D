import { Delaunay } from 'd3-delaunay';
import ClipperLib from 'clipper-lib';
import { layout, validateSettings, type Settings } from './settings';

export type Point = [number, number];
export interface Diagnostic { cells: Point[][]; affected: number[]; width: number; height: number; parameter?: string }
export class GeometryIssue extends Error {
  diagnostic?: Diagnostic;
  constructor(message: string, public affected: number[], public parameter?: string) { super(message); }
}
export interface Edge {
  id: string; a: Point; b: Point; cells: number[]; points: Point[];
  requestedSize: number; size: number; curvature: number;
}
export interface Piece { id: number; base: Point[]; nominal: Point[]; outline: Point[]; center: Point }
export interface Pattern {
  settings: Settings; pieces: Piece[]; edges: Edge[]; warnings: string[];
  rows: number; columns: number; elapsed: number; minTab: number; maxTab: number;
  tabCapacity: { min: number; max: number };
  minCurve: number; maxCurve: number;
}
const SCALE = 100000; // integer operations at 0.00001 mm resolution
const EPS = 1 / SCALE;
const snap = (n: number) => Math.round(n * SCALE) / SCALE;
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const minimumTabDepth = (s: Settings) => Math.max(0.8, (s.clearance + 0.5) / (s.tabStyle === 'jigsaw' ? 0.55 : 0.65));
const key = (p: Point) => `${p[0]},${p[1]}`;
const edgeKey = (a: Point, b: Point) => key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`;
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function area(p: Point[]) { return p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2; }
function mean(p: Point[]): Point { return [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length]; }
function cross(a: Point, b: Point, c: Point) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }

export function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function poissonPoints(n: number, w: number, h: number, random: () => number): Point[] {
  // Exact-count hard-core Poisson sampling. Restart with a smaller exclusion radius
  // if rejection sampling saturates; never silently fall back to a grid.
  let radius = 0.72 * Math.sqrt(w * h / n);
  for (let restart = 0; restart < 24; restart++, radius *= 0.9) {
    const points: Point[] = [];
    const bins = new Map<string, Point[]>(); const step = radius / Math.SQRT2;
    for (let attempt = 0; attempt < Math.max(1000, n * 350) && points.length < n; attempt++) {
      const p: Point = [w * (0.015 + random() * 0.97), h * (0.015 + random() * 0.97)];
      const bx = Math.floor(p[0] / step), by = Math.floor(p[1] / step);
      let valid = true;
      for (let x = bx - 2; x <= bx + 2 && valid; x++) for (let y = by - 2; y <= by + 2 && valid; y++)
        for (const q of bins.get(`${x},${y}`) || []) if (distance(p, q) < radius) { valid = false; break; }
      if (valid) { points.push(p); const k = `${bx},${by}`; bins.set(k, [...(bins.get(k) || []), p]); }
    }
    if (points.length === n) return points;
  }
  throw new Error('Could not place Poisson points. Try a less narrow boundary or another seed.');
}

function basePolygons(s: Settings): { polygons: Point[][]; rows: number; columns: number } {
  const grid = layout(s), { rows, columns } = grid;
  if (s.geometry === 'rectangular') {
    const polygons: Point[][] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const x = s.width * c / columns, y = s.height * r / rows;
      const xx = s.width * (c + 1) / columns, yy = s.height * (r + 1) / rows;
      polygons.push([[x, y], [xx, y], [xx, yy], [x, yy]]);
    }
    return { polygons, ...grid };
  }
  const random = seededRandom(`${s.seed}:points`);
  let points: Point[];
  if (s.distribution === 'poisson') points = poissonPoints(s.count, s.width, s.height, random);
  else {
    points = [];
    const nr = s.sizingMode === 'size' ? rows : Math.max(1, Math.floor(Math.sqrt(s.count)));
    // Balanced rows keep the requested point count, including prime counts.
    for (let r = 0; r < nr; r++) {
      const nc = Math.floor(s.count / nr) + (r < s.count % nr ? 1 : 0);
      for (let c = 0; c < nc; c++) points.push([
        (c + 0.5 + (random() - 0.5) * (s.jitterEnabled ? s.jitter : 0)) * s.width / nc,
        (r + 0.5 + (random() - 0.5) * (s.jitterEnabled ? s.jitter : 0)) * s.height / nr,
      ]);
    }
  }
  const v = Delaunay.from(points).voronoi([0, 0, s.width, s.height]);
  const polygons = points.map((_, i) => {
    const p = v.cellPolygon(i);
    if (!p) throw new Error('A seed produced an empty cell. Try another seed.');
    return p.slice(0, -1) as Point[];
  });
  return { polygons, ...grid };
}

const toClip = (p: Point[]) => p.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromClip = (p: ClipperLib.Path): Point[] => p.map(v => [v.X / SCALE, v.Y / SCALE]);
export function booleanPaths(subject: Point[][], clip: Point[][], type: 'intersection' | 'difference' | 'union'): Point[][] {
  const c = new ClipperLib.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(subject.map(toClip), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip.map(toClip), ClipperLib.PolyType.ptClip, true);
  const result: ClipperLib.Paths = [];
  const operation = { intersection: ClipperLib.ClipType.ctIntersection, difference: ClipperLib.ClipType.ctDifference, union: ClipperLib.ClipType.ctUnion }[type];
  c.Execute(operation, result, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return result.map(fromClip);
}

export function isSimple(p: Point[]): boolean {
  const on = (a: Point, b: Point, c: Point) => Math.abs(cross(a, b, c)) < 1e-8 && c[0] >= Math.min(a[0], b[0]) - EPS && c[0] <= Math.max(a[0], b[0]) + EPS && c[1] >= Math.min(a[1], b[1]) - EPS && c[1] <= Math.max(a[1], b[1]) + EPS;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (distance(a, b) < EPS / 2) return false;
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const c = p[j], d = p[(j + 1) % p.length];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return false;
    }
  }
  return p.length >= 3 && Math.abs(area(p)) > 0.001;
}

// Reserve a triangle from each edge to the cell's interior center. Check the
// selected profile's convex envelope, rather than an oversized square box.
// A 6% reserve keeps neighboring features separated inside their triangles.
function safeSize(e: Edge, centers: Point[], style: Settings['tabStyle']): number {
  const len = distance(e.a, e.b), u: Point = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len];
  const mid: Point = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  let limit = Math.min(100, len / 2);
  // The rounded envelope contains every cubic control point, so it also
  // contains every point on the curve, independent of tessellation tolerance.
  const envelope = style === 'jigsaw'
    ? [[-1,0],[-.6,.8],[-.35,1],[.35,1],[.6,.8],[1,0]]
    : style === 'triangular' ? [[-1,.3],[0,1],[1,.3],[-.4,0],[.4,0]]
    : [[-1,0],[-1,1],[1,1],[1,0]];
  for (const cell of e.cells) {
    const center = centers[cell];
    const sign = cross(e.a, e.b, center) > 0 ? 1 : -1;
    const normal: Point = [-u[1] * sign, u[0] * sign];
    const tri = [e.a, e.b, center];
    const fits = (size: number) => envelope.every(([t, depth]) => {
      const p: Point = [mid[0] + (u[0] * t + normal[0] * depth) * size, mid[1] + (u[1] * t + normal[1] * depth) * size];
      return tri.every((a, i) => cross(a, tri[(i + 1) % 3], p) * sign >= -1e-9);
    });
    let lo = 0, hi = limit;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    limit = lo;
  }
  return limit * 0.94;
}

function jigsawProfile(size: number): Point[] {
  // Tangent-continuous shoulders, a narrow neck, and a rounded bulb. All
  // control points stay in the same reserved envelope as the angular tabs.
  const curves: [Point, Point, Point, Point][] = [
    [[-1, 0], [-0.65, 0], [-0.3, 0], [-0.3, 0.14]],
    [[-0.3, 0.14], [-0.3, 0.28], [-0.6, 0.28], [-0.6, 0.55]],
    [[-0.6, 0.55], [-0.6, 0.8], [-0.35, 1], [0, 1]],
    [[0, 1], [0.35, 1], [0.6, 0.8], [0.6, 0.55]],
    [[0.6, 0.55], [0.6, 0.28], [0.3, 0.28], [0.3, 0.14]],
    [[0.3, 0.14], [0.3, 0], [0.65, 0], [1, 0]],
  ];
  const points: Point[] = [curves[0][0]];
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tolerance = 0.005 / size;
  function flatten(a: Point, b: Point, c: Point, d: Point, depth = 0) {
    const length = distance(a, d);
    const deviation = length ? Math.max(Math.abs(cross(a, d, b)), Math.abs(cross(a, d, c))) / length : Math.max(distance(a, b), distance(a, c));
    if (deviation <= tolerance || depth === 12) { points.push(d); return; }
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
    flatten(a, ab, abc, middle, depth + 1);
    flatten(middle, bcd, cd, d, depth + 1);
  }
  // Flatten once per shared seam, to a 0.005 mm chord tolerance, so clipping,
  // sockets, preview, and both SVG modes all use the same vector geometry.
  for (const curve of curves) flatten(...curve);
  return points;
}

function tabPoints(e: Edge, size: number, style: Settings['tabStyle'], sign: number): Point[] {
  const len = distance(e.a, e.b), u: Point = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len], n: Point = [-u[1] * sign, u[0] * sign];
  const m: Point = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  const coords = style === 'jigsaw' ? jigsawProfile(size) : style === 'rectangular'
    ? [[-0.4, 0], [-0.4, 0.35], [-1, 0.35], [-1, 1], [1, 1], [1, 0.35], [0.4, 0.35], [0.4, 0]]
    : [[-0.4, 0], [-0.4, 0.3], [-1, 0.3], [0, 1], [1, 0.3], [0.4, 0.3], [0.4, 0]];
  return [e.a, ...coords.map(([x, y]): Point => [snap(m[0] + size * (u[0] * x + n[0] * y)), snap(m[1] + size * (u[1] * x + n[1] * y))]), e.b];
}

function curveSeam(edge: Edge, centers: Point[], amplitude: number, sign: number) {
  const length = distance(edge.a, edge.b);
  const u: Point = [(edge.b[0]-edge.a[0])/length,(edge.b[1]-edge.a[1])/length];
  const n: Point = [-u[1]*sign,u[0]*sign];
  const localX = (p: Point) => Math.max(0,Math.min(1,((p[0]-edge.a[0])*u[0]+(p[1]-edge.a[1])*u[1])/length));
  const samples: Point[] = [edge.a];
  // The quadratic bow is flattened with <= 0.005 mm chord error. Warp tab
  // vertices too, so the neck joins the same curved baseline continuously.
  for(let i=1;i<edge.points.length;i++) {
    const a=edge.points[i-1],b=edge.points[i];
    const steps=Math.max(1,Math.ceil(Math.abs(localX(b)-localX(a))*Math.sqrt(amplitude/.005)));
    for(let j=1;j<=steps;j++) samples.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);
  }
  const warp = (p: Point, depth: number): Point => {
    const t=localX(p), bow=4*t*(1-t)*depth;
    return [p[0]+n[0]*bow,p[1]+n[1]*bow];
  };
  const inside = (p: Point) => edge.cells.some(id=>{
    const tri=[edge.a,edge.b,centers[id]], orientation=Math.sign(cross(edge.a,edge.b,centers[id]));
    return tri.every((a,i)=>cross(a,tri[(i+1)%3],p)*orientation>=-1e-8);
  });
  let low=0,high=amplitude;
  // Stay in the union of this edge's two reserved fan triangles. Adjacent
  // edges use disjoint fans, so their bows cannot cross or leave the boundary.
  for(let i=0;i<28;i++) {
    const middle=(low+high)/2;
    if(samples.every(p=>inside(warp(p,middle)))) low=middle; else high=middle;
  }
  edge.curvature=snap(low>=amplitude*(1-1e-6)?amplitude:low*.95);
  edge.points=samples.map(p=>warp(p,edge.curvature).map(snap) as Point);
  edge.points[0]=edge.a; edge.points[edge.points.length-1]=edge.b;
}

function validatePiece(p: Point[], s: Settings, id: number, stage = 'tab geometry') {
  if (!isSimple(p)) throw new GeometryIssue(`Piece ${id + 1} would self-intersect after ${stage}. Reduce tab size or change the seed.`, [id], stage === 'clearance' ? 'clearance' : 'tabSize');
  if (p.some(([x, y]) => x < -EPS || y < -EPS || x > s.width + EPS || y > s.height + EPS))
    throw new GeometryIssue(`Piece ${id + 1} would exceed the boundary. Try smaller tabs.`, [id], 'tabSize');
  if (Math.abs(area(p)) < 1) throw new GeometryIssue(`Piece ${id + 1} is smaller than 1 mm². Increase dimensions or use fewer pieces.`, [id], stage === 'clearance' ? 'clearance' : 'count');
}

function registryFor(polygons: Point[][]): Map<string, Edge> {
  const registry = new Map<string, Edge>();
  for (let cell = 0; cell < polygons.length; cell++) {
    const p = polygons[cell];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], k = edgeKey(a, b);
      if (!registry.has(k)) registry.set(k, { id: `edge-${String(registry.size + 1).padStart(4, '0')}`, a, b, cells: [], points: [a, b], requestedSize: 0, size: 0, curvature: 0 });
      registry.get(k)!.cells.push(cell);
    }
  }
  return registry;
}

function simplifyShortSeams(polygons: Point[][], s: Settings): { polygons: Point[][]; merged: number } {
  if (s.geometry !== 'voronoi' || s.tabStyle === 'none') return { polygons, merged: 0 };
  const minimum = Math.max(minimumTabDepth(s), s.randomTabs ? s.tabMin : 0);
  let merged = 0;
  const boundary = (p: Point) => p[0] === 0 || p[1] === 0 || p[0] === s.width || p[1] === s.height;
  // Collapse a short seam globally, never per piece. This turns nearly coincident
  // triple vertices into one shared vertex while keeping the same piece count.
  // Only accept a collapse that keeps every affected polygon simple and star-shaped.
  for (let iteration = 0; iteration < 400; iteration++) {
    const centers = polygons.map(mean);
    const candidates = [...registryFor(polygons).values()].filter(e => e.cells.length === 2 && safeSize(e, centers, s.tabStyle) < minimum * 1.02 && distance(e.a, e.b) < minimum * 8).sort((a, b) => distance(a.a, a.b) - distance(b.a, b.b));
    let accepted = false;
    for (const e of candidates) {
      if (boundary(e.a) && boundary(e.b)) continue;
      const point: Point = boundary(e.a) ? e.a : boundary(e.b) ? e.b : [snap((e.a[0] + e.b[0]) / 2), snap((e.a[1] + e.b[1]) / 2)];
      let okay = true;
      const next = polygons.map(p => {
        if (!p.some(v => same(v, e.a) || same(v, e.b))) return p;
        const replaced = p.map(v => same(v, e.a) || same(v, e.b) ? point : v);
        const q = replaced.filter((v, i) => !same(v, replaced[(i + replaced.length - 1) % replaced.length]));
        const center = mean(q);
        if (q.length < 3 || !isSimple(q) || area(q) < 1 || q.some((a, i) => cross(a, q[(i + 1) % q.length], center) <= 1e-6)) okay = false;
        return q;
      });
      if (okay) { polygons = next; merged++; accepted = true; break; }
    }
    if (!accepted) break;
  }
  return { polygons, merged };
}

export function generate(input: Settings): Pattern {
  const s = validateSettings(input), context: { cells?: Point[][] } = {};
  try { return generatePattern(s, context); }
  catch (error) {
    if (error instanceof GeometryIssue && context.cells) error.diagnostic = { cells: context.cells, affected: error.affected, width: s.width, height: s.height, parameter: error.parameter };
    throw error;
  }
}
function generatePattern(input: Settings, context: { cells?: Point[][] }): Pattern {
  const start = performance.now();
  const s = validateSettings(input), result = basePolygons(s);
  let polygons = result.polygons.map(poly => {
    let p = poly.map(([x, y]): Point => [snap(x), snap(y)]).filter((v, i, a) => !same(v, a[(i + a.length - 1) % a.length]));
    if (area(p) < 0) p = p.reverse();
    return p;
  });
  const simplified = simplifyShortSeams(polygons, s); polygons = simplified.polygons;
  context.cells = polygons;
  const centers = polygons.map(mean), registry = registryFor(polygons);
  const edges = [...registry.values()], warnings: string[] = [];
  const capacities = edges.filter(e => e.cells.length === 2).map(e => safeSize(e, centers, s.tabStyle));
  const tabCapacity = { min: capacities.length ? Math.floor(Math.min(...capacities) * 100) / 100 : 0, max: capacities.length ? Math.floor(Math.max(...capacities) * 100) / 100 : 0 };
  if (simplified.merged) warnings.push(`${simplified.merged} short Voronoi seam${simplified.merged === 1 ? '' : 's'} merged at shared vertices to make room for usable tabs. Piece count preserved.`);
  let capped = 0;
  const tabIssues: GeometryIssue[] = [];
  for (const e of edges) {
    if (e.cells.length > 2) throw new Error('Invalid edge topology. Try another seed.');
    if (e.cells.length === 1) {
      const onBoundary = e.a[0] === e.b[0] && (e.a[0] === 0 || e.a[0] === s.width) || e.a[1] === e.b[1] && (e.a[1] === 0 || e.a[1] === s.height);
      if (!onBoundary) throw new Error('A very short Voronoi edge could not be resolved. Change the seed or reduce jitter.');
      continue;
    }
    if (s.tabStyle === 'none') continue;
    const random = seededRandom(`${s.seed}:tab:${e.id}`);
    e.requestedSize = s.randomTabs ? s.tabMin + random() * (s.tabMax - s.tabMin) : s.tabSize;
    e.size = snap(Math.min(e.requestedSize, safeSize(e, centers, s.tabStyle)));
    // Reserve at least 0.5 mm after clearance, with extra allowance for
    // the rounded style's narrower neck and curved transitions.
    const minimum = minimumTabDepth(s);
    if (e.size < minimum) { tabIssues.push(new GeometryIssue(`A short seam cannot fit a safe tab (available ${e.size.toFixed(2)} mm; need ${minimum.toFixed(2)} mm). Try another seed, fewer pieces, larger dimensions, lower clearance, or Tabs: None.`, e.cells, s.clearance > 0 ? 'clearance' : 'tabSize')); continue; }
    if (e.size + EPS < e.requestedSize) capped++;
    if (s.randomTabs && e.size + EPS < s.tabMin) { tabIssues.push(new GeometryIssue(`A seam cannot fit the minimum random tab size (${s.tabMin} mm). Lower the minimum, increase dimensions, or change the seed.`, e.cells, 'tabMin')); continue; }
    e.points = tabPoints(e, e.size, s.tabStyle, random() < 0.5 ? -1 : 1);
  }
  if (tabIssues.length) throw new GeometryIssue(tabIssues[0].message, [...new Set(tabIssues.flatMap(issue => issue.affected))], tabIssues[0].parameter);
  if(s.curvatureEnabled && s.seamCurvature>0) {
    let limited=0;
    for(const edge of edges.filter(e=>e.cells.length===2)) {
      const random=seededRandom(`${s.seed}:curve:${edge.id}`);
      curveSeam(edge,centers,s.seamCurvature,random()<.5?-1:1);
      if(edge.curvature<s.seamCurvature-EPS) limited++;
    }
    if(limited) warnings.push(`${limited} seam bends limited by neighboring geometry. Actual curvature is shown in Pattern settings.`);
  }
  if (capped) warnings.push(`${capped} tab${capped === 1 ? '' : 's'} limited by local space. Actual sizes are shown below.`);
  const pieces: Piece[] = polygons.map((base, id) => {
    const nominal: Point[] = [];
    for (let i = 0; i < base.length; i++) {
      const a = base[i], b = base[(i + 1) % base.length], edge = registry.get(edgeKey(a, b))!;
      const path = same(a, edge.a) ? edge.points : [...edge.points].reverse();
      nominal.push(...path.slice(0, -1));
    }
    validatePiece(nominal, s, id);
    return { id, base, nominal, outline: nominal, center: centers[id] };
  });
  // Remove a real geometric channel of total width clearance from both neighbors.
  // Outer edges are never offset; open-square seam caps cover junctions fully.
  if (s.clearance > 0) {
    const offset = new ClipperLib.ClipperOffset(2, 0.01 * SCALE);
    offset.AddPaths(edges.filter(e => e.cells.length === 2).map(e => toClip(e.points)), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etOpenSquare);
    const channels: ClipperLib.Paths = [];
    offset.Execute(channels, s.clearance * SCALE / 2);
    const channelPolygons = channels.map(fromClip);
    for (const piece of pieces) {
      const paths = booleanPaths([piece.nominal], channelPolygons, 'difference');
      if (paths.length !== 1) throw new GeometryIssue(`Clearance splits or erases piece ${piece.id + 1}. Reduce clearance, increase dimensions, or use fewer pieces.`, [piece.id], 'clearance');
      // Integer offset intersections can leave one-unit spikes at junctions.
      // Remove only numerical artifacts within 0.00002 mm before validation.
      piece.outline = fromClip(ClipperLib.Clipper.CleanPolygon(toClip(paths[0]), 2));
      validatePiece(piece.outline, s, piece.id, 'clearance');
      if (Math.abs(area(piece.outline)) < Math.abs(area(piece.nominal)) * 0.5)
        throw new GeometryIssue(`Clearance removes too much of piece ${piece.id + 1}. Reduce clearance or use fewer pieces.`, [piece.id], 'clearance');
    }
  }
  // A union checks the partition as a whole, beyond each individual polygon.
  const united = booleanPaths(pieces.map(p => p.nominal), [], 'union');
  const totalArea = united.reduce((n, p) => n + area(p), 0);
  const sumArea = pieces.reduce((n, p) => n + Math.abs(area(p.nominal)), 0);
  const tolerance = Math.max(0.005, s.width * s.height * 1e-7);
  const rectangle: Point[] = [[0, 0], [s.width, 0], [s.width, s.height], [0, s.height]];
  // Clipper can retain touching components in its union output. Check actual
  // coverage against the boundary rather than requiring one output contour.
  const missing = booleanPaths([rectangle], united, 'difference').reduce((n, p) => n + Math.abs(area(p)), 0);
  if (missing > tolerance || Math.abs(Math.abs(totalArea) - s.width * s.height) > tolerance || Math.abs(sumArea - s.width * s.height) > tolerance)
    throw new Error('The pieces did not form a complete, non-overlapping partition. Try a different seed.');
  if (s.geometry === 'rectangular' && pieces.length !== s.count) warnings.push(`Requested ${s.count}; this ${result.rows} × ${result.columns} grid contains ${pieces.length} pieces.`);
  const sizes = edges.filter(e => e.size > 0).map(e => e.size);
  const curves=edges.filter(e=>e.cells.length===2).map(e=>e.curvature);
  return { settings: s, pieces, edges, warnings, rows: result.rows, columns: result.columns, elapsed: performance.now() - start, minTab: sizes.length ? Math.min(...sizes) : 0, maxTab: sizes.length ? Math.max(...sizes) : 0, tabCapacity, minCurve:curves.length?Math.min(...curves):0,maxCurve:curves.length?Math.max(...curves):0 };
}

// A physical gap can consume a small tab. Keep strict generation available for
// validation, while the UI can recover by explicitly reporting a smaller gap.
export function generateWithClearance(input: Settings): Pattern {
  const s = validateSettings(input);
  try { return generate(s); }
  catch (error) {
    if (!s.autoClearance || !s.clearance || !/clearance|safe tab|smaller than 1 mm²|self-intersect/i.test((error as Error).message)) throw error;
    let best = generate({ ...s, clearance: 0 });
    let low = 0, high = s.clearance;
    for (let i = 0; i < 10; i++) {
      const clearance = (low + high) / 2;
      try { best = generate({ ...s, clearance }); low = clearance; }
      catch { high = clearance; }
    }
    const clearance = Math.floor(best.settings.clearance * 100) / 100;
    best = generate({ ...s, clearance });
    best.warnings.unshift(`Clearance adjusted from ${s.clearance} to ${clearance} mm to preserve usable pieces. Increase dimensions or reduce piece count for a larger gap.`);
    return best;
  }
}
