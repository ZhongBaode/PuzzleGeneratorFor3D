export interface Settings {
  width: number; height: number; aspectLock: boolean;
  count: number; rows: number; columns: number; gridMode: 'auto' | 'manual';
  distribution: 'grid' | 'poisson'; geometry: 'rectangular' | 'voronoi';
  seed: string; jitter: number; seamCurvature: number;
  tabStyle: 'jigsaw' | 'rectangular' | 'triangular' | 'none'; tabSize: number;
  randomTabs: boolean; tabMin: number; tabMax: number;
  clearance: number; strokeWidth: number;
  autoClearance: boolean; customFits: boolean;
  fitSuperTight: number; fitTight: number; fitLoose: number;
  exportMode: 'cut' | 'pieces' | 'mask'; exportColors: boolean; exportLabels: boolean;
  previewMode: 'cut' | 'pieces' | 'mask'; colors: boolean; numbers: boolean;
}

export const defaults: Settings = {
  width: 200, height: 160, aspectLock: false,
  count: 25, rows: 5, columns: 5, gridMode: 'auto',
  distribution: 'grid', geometry: 'rectangular', seed: 'foundry-2026', jitter: 0.25, seamCurvature: 0,
  tabStyle: 'rectangular', tabSize: 4, randomTabs: false, tabMin: 2, tabMax: 5,
  clearance: 0.2, strokeWidth: 0.25,
  autoClearance: true, customFits: false, fitSuperTight: 0.05, fitTight: 0.15, fitLoose: 0.3,
  exportMode: 'pieces', exportColors: false, exportLabels: false,
  previewMode: 'cut', colors: true, numbers: false,
};

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object.');
  const s = { ...defaults, ...Object.fromEntries(Object.keys(defaults).filter(k => k in value).map(k => [k, (value as Record<string, unknown>)[k]])) } as Settings;
  const ranges: Partial<Record<keyof Settings, [number, number]>> = {
    width: [10, 2000], height: [10, 2000], count: [1, 200], rows: [1, 30], columns: [1, 30],
    jitter: [0, 0.8], seamCurvature: [0, 20], tabSize: [0.5, 100], tabMin: [0.5, 100], tabMax: [0.5, 100],
    clearance: [0, 3], strokeWidth: [0.01, 3],
    fitSuperTight: [0, 3], fitTight: [0, 3], fitLoose: [0, 3],
  };
  for (const [key, range] of Object.entries(ranges)) {
    const n = s[key as keyof Settings];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < range[0] || n > range[1])
      throw new Error(`${key}: enter a number from ${range[0]} to ${range[1]}.`);
  }
  for (const key of ['count', 'rows', 'columns'] as const)
    if (!Number.isInteger(s[key])) throw new Error(`${key} must be a whole number.`);
  const choices = { geometry: ['rectangular', 'voronoi'], distribution: ['grid', 'poisson'], gridMode: ['auto', 'manual'], tabStyle: ['jigsaw', 'rectangular', 'triangular', 'none'], exportMode: ['cut', 'pieces', 'mask'], previewMode: ['cut', 'pieces', 'mask'] };
  for (const [key, options] of Object.entries(choices))
    if (!options.includes(s[key as keyof Settings] as string)) throw new Error(`Invalid ${key}.`);
  for (const key of ['aspectLock', 'randomTabs', 'exportColors', 'exportLabels', 'colors', 'numbers', 'autoClearance', 'customFits'] as const)
    if (typeof s[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
  if (typeof s.seed !== 'string' || !s.seed.trim() || s.seed.length > 120) throw new Error('Enter a seed of 1–120 characters.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(s.seed)) throw new Error('Seed contains a control character that SVG cannot encode. Use printable text.');
  if (s.randomTabs && s.tabMin > s.tabMax) throw new Error('Minimum tab size must be no larger than maximum tab size.');
  if (s.rows * s.columns > 200 && s.gridMode === 'manual') throw new Error('Use at most 200 pieces in a manual grid.');
  return s;
}

// The count is a request; manual grids deliberately retain their row/column structure.
export function layout(s: Settings) {
  if (s.gridMode === 'manual') return { rows: s.rows, columns: s.columns };
  const rows = Math.max(1, Math.floor(Math.sqrt(s.count)));
  return { rows, columns: Math.ceil(s.count / rows) };
}

export const starterPresets = [
  { id: 'starter-regular', name: 'Regular · 25 pieces', settings: { ...defaults } },
  { id: 'starter-jitter', name: 'Jittered · Voronoi', settings: { ...defaults, geometry: 'voronoi' as const, jitter: 0.35, seed: 'jitter-workshop', clearance: 0.15, tabSize: 3 } },
  { id: 'starter-poisson', name: 'Organic · Poisson', settings: { ...defaults, geometry: 'voronoi' as const, distribution: 'poisson' as const, count: 16, seed: 'organic-workshop', tabStyle: 'triangular' as const, clearance: 0.15, tabSize: 3 } },
];
