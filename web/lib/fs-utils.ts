/**
 * Safe file-system readers used by the sync layer.
 * Never throw — always return a null / [] when a file is missing or malformed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

export function readJsonSafe<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
  catch { return null; }
}

export function readJsonlSafe<T = unknown>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim(); if (!t) continue;
      try { out.push(JSON.parse(t) as T); } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }
  return out;
}

export function listDirSafe(path: string): string[] {
  if (!existsSync(path)) return [];
  try { return readdirSync(path); } catch { return []; }
}

export function statMtime(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return new Date(statSync(path).mtimeMs).toISOString(); } catch { return null; }
}
