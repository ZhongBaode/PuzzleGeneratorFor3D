import { starterPresets, validateSettings, type Settings } from './settings';
export interface Preset { id: string; name: string; settings: Settings }
export const STORAGE_KEY = 'puzzle-foundry-presets-v1';
export function readPresets(): Preset[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? structuredClone(starterPresets) : parsePresets(JSON.parse(raw));
}
export function writePresets(presets: Preset[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets })); }
export function parsePresets(value: unknown): Preset[] {
  const data = value as { version?: number; presets?: unknown[] };
  if (!data || data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 100)
    throw new Error('Use a Puzzle Foundry version 1 preset file with at most 100 presets.');
  const ids = new Set<string>();
  return data.presets.map(item => {
    const p = item as Preset;
    if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || typeof p.id !== 'string' || p.id.length > 150 || ids.has(p.id))
      throw new Error('Each preset needs a unique ID and a name of 1–100 characters.');
    ids.add(p.id);
    return { id: p.id, name: p.name.trim(), settings: validateSettings(p.settings) };
  });
}
