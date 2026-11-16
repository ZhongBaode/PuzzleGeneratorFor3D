import { booleanPaths, type Pattern, type Point } from './geometry';
export const palette = ['#c5d6bf', '#d9c9a8', '#b9ccd6', '#d8bfb2', '#bdc5ab', '#d9d8b8', '#c5c3d4', '#d2be9d'];
export function pathData(points: Point[], closed = true): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${+x.toFixed(5)} ${+y.toFixed(5)}`).join(' ') + (closed ? ' Z' : '');
}
export function escapeXml(value: string) { return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!); }
export function svgFilename(p: Pattern) {
  const s = p.settings, seed = s.seed.replace(/[^a-z0-9_-]/gi, '_').slice(0, 70);
  const tabs = s.tabStyle === 'none' ? 'no-tabs' : s.randomTabs ? `tabs-${s.tabMin}-${s.tabMax}mm` : `tab-${s.tabSize}mm`;
  return `puzzle-${s.width}x${s.height}mm-${s.seed && seed}-${tabs}-fit-${s.clearance}mm-${s.exportMode === 'mask' ? 'cutting-mask' : s.exportMode === 'cut' ? 'cut-lines' : 'piece-outlines'}.svg`;
}
export function cuttingMaskError(p: Pattern): string | undefined {
  if (p.settings.clearance <= 0) return 'Cutting mask needs clearance greater than 0 mm to create a real cutting channel.';
  if (p.pieces.length < 2) return 'Cutting mask needs at least two pieces; this pattern has no internal seams.';
}
export function cuttingMask(p: Pattern): Point[][] {
  const error = cuttingMaskError(p); if (error) throw new Error(error);
  const {width, height} = p.settings;
  const bounds: Point[] = [[0,0],[width,0],[width,height],[0,height]];
  // The cutter is the complement of the actual clearance-adjusted pieces.
  // Preserve holes as subpaths of one filled path; do not add a background.
  const mask = booleanPaths([bounds], p.pieces.map(piece => piece.outline), 'difference');
  if (!mask.length) throw new Error('This pattern has no cutting area. Increase clearance.');
  return mask;
}
export function exportSvg(p: Pattern): string {
  const s = p.settings;
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}mm" height="${s.height}mm" viewBox="0 0 ${s.width} ${s.height}">`,
    `<title>${escapeXml(`Puzzle Foundry · ${p.pieces.length} pieces · seed ${s.seed}`)}</title>`,
    `<metadata id="puzzle-settings">${escapeXml(JSON.stringify({ generator: 'Puzzle Foundry', geometryVersion: 4, units: 'mm', actualCount: p.pieces.length, actualTabRange: [p.minTab, p.maxTab], actualCurveRange:[p.minCurve,p.maxCurve], settings: s }))}</metadata>`];
  if (s.exportMode === 'mask') {
    out.push('<desc>Subtract the filled channels from the model. The holes are the puzzle pieces to keep. No background, strokes, colors, or labels are exported.</desc>');
    out.push(`<path id="cutting-mask" d="${cuttingMask(p).map(points => pathData(points)).join(' ')}" fill="#000000" fill-rule="evenodd" stroke="none"/>`);
  } else if (s.exportMode === 'pieces') {
    out.push(`<g id="piece-outlines" stroke="#000000" stroke-width="${s.strokeWidth}" stroke-linejoin="miter" fill-rule="nonzero">`);
    for (const piece of p.pieces) out.push(`<path id="piece-${String(piece.id + 1).padStart(3, '0')}" d="${pathData(piece.outline)}" fill="${s.exportColors ? palette[piece.id % palette.length] : '#ffffff'}"/>`);
    out.push('</g>');
  } else {
    if (s.exportColors) {
      out.push('<g id="decoration-colors" stroke="none">');
      for (const piece of p.pieces) out.push(`<path id="color-${String(piece.id + 1).padStart(3, '0')}" d="${pathData(piece.nominal)}" fill="${palette[piece.id % palette.length]}"/>`);
      out.push('</g>');
    }
    out.push(`<g id="cut-lines" fill="none" stroke="#000000" stroke-width="${s.strokeWidth}" stroke-linejoin="miter">`);
    out.push(`<path id="boundary" fill="${s.exportColors ? 'none' : '#ffffff'}" d="M0 0 L${s.width} 0 L${s.width} ${s.height} L0 ${s.height} Z"/>`);
    for (const edge of p.edges.filter(e => e.cells.length === 2)) out.push(`<path id="${edge.id}" d="${pathData(edge.points, false)}"/>`);
    out.push('</g>');
  }
  if (s.exportLabels && s.exportMode !== 'mask') {
    out.push('<g id="piece-labels" fill="#000000" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">');
    const fontSize = Math.min(4, Math.sqrt(s.width * s.height / p.pieces.length) / 7);
    for (const piece of p.pieces) out.push(`<text id="label-${piece.id + 1}" x="${piece.center[0]}" y="${piece.center[1]}" font-size="${fontSize}">${piece.id + 1}</text>`);
    out.push('</g>');
  }
  out.push('</svg>'); return out.join('\n');
}
