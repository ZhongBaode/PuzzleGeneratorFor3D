import type { Raster } from './image-model';

export const basicSwatches = [
  ['Jade White', '#FFFFFF'], ['Black', '#000000'], ['Gray', '#8E9089'], ['Silver', '#A6A9AA'],
  ['Red', '#C12E1F'], ['Maroon Red', '#9D2235'], ['Pink', '#F55A74'], ['Hot Pink', '#F5547C'],
  ['Orange', '#FF6A13'], ['Pumpkin Orange', '#FF9016'], ['Yellow', '#F4EE2A'], ['Gold', '#E4BD68'],
  ['Sunflower Yellow', '#FEC600'], ['Bright Green', '#BECF00'], ['Bambu Green', '#00AE42'], ['Mistletoe Green', '#3F8E43'],
  ['Blue', '#0A2989'], ['Cobalt Blue', '#0056B8'], ['Cyan', '#0086D6'], ['Turquoise', '#00B1B7'],
  ['Purple', '#5E43B7'], ['Indigo Purple', '#482960'], ['Blue Grey', '#5B6579'], ['Light Gray', '#D1D3D5'],
  ['Beige', '#F7E6DE'], ['Light Beige', '#D8C3A5'], ['Brown', '#9D432C'], ['Cocoa Brown', '#6F5034'],
] as const;
export const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = (v: number[]) => '#' + v.map(n => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
const distance = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0);
export function nearest(pixel: number[], palette: number[][]) {
  let best = 0; for (let i = 1; i < palette.length; i++) if (distance(pixel, palette[i]) < distance(pixel, palette[best])) best = i; return best;
}
// Deterministic weighted k-means on a 5-bit RGB histogram. Alpha is composited over white by the crop canvas.
export function detectPalette(data: Uint8ClampedArray): string[] {
  const bins = new Map<number, { sum: number[]; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const k = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    const b = bins.get(k) || { sum: [0, 0, 0], n: 0 };
    b.n++; for (let c = 0; c < 3; c++) b.sum[c] += data[i + c]; bins.set(k, b);
  }
  const samples = [...bins.values()].map(b => ({ p: b.sum.map(n => n / b.n), n: b.n })).sort((a, b) => b.n - a.n);
  if (!samples.length) throw new Error('The image has no pixels.');
  const centers = [samples[0].p];
  while (centers.length < 4) {
    let best = samples[0], score = -1;
    for (const s of samples) { const d = distance(s.p, centers[nearest(s.p, centers)]) * Math.sqrt(s.n); if (d > score) { score = d; best = s; } }
    centers.push([...best.p]);
  }
  for (let step = 0; step < 14; step++) {
    const sums = centers.map(() => [0, 0, 0]), counts = [0, 0, 0, 0];
    for (const s of samples) { const i = nearest(s.p, centers); counts[i] += s.n; for (let c = 0; c < 3; c++) sums[i][c] += s.p[c] * s.n; }
    for (let i = 0; i < 4; i++) if (counts[i]) centers[i] = sums[i].map(n => n / counts[i]);
  }
  return centers.map(hex);
}
export function rasterSize(width: number, nozzle: number) {
  // At least two nozzle diameters per pixel; cap complexity without promising sub-nozzle detail.
  const columns = Math.max(16, Math.min(384, Math.floor(width / (2 * nozzle) / 16) * 16));
  return { width: columns, height: columns * 9 / 16 };
}
export function mapRaster(data: Uint8ClampedArray, width: number, height: number, colors: string[]): Raster {
  if (data.length !== width * height * 4 || colors.length !== 4 || colors.some(c => !/^#[0-9a-f]{6}$/i.test(c))) throw new Error('Invalid image or four-color palette.');
  const labels = new Uint8Array(width * height), palette = colors.map(rgb);
  for (let i = 0; i < labels.length; i++) labels[i] = nearest([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], palette);
  return { width, height, labels };
}
