import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root (Mimmo_Video_Pipeline). */
export const ROOT = path.resolve(here, '..', '..');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  storyFile: path.join(ROOT, 'config', 'story.json'),
  src: path.join(ROOT, 'src'),
  public: path.join(ROOT, 'public'),
  audio: path.join(ROOT, 'public', 'audio'),
  characters: path.join(ROOT, 'public', 'characters'),
  assets: path.join(ROOT, 'assets'),
  assetsCharacters: path.join(ROOT, 'assets', 'characters'),
  output: path.join(ROOT, 'output'),
  temp: path.join(ROOT, 'temp'),
  server: path.join(ROOT, 'server'),
  webapp: path.join(ROOT, 'server', 'webapp'),
  tests: path.join(ROOT, 'tests'),
};

/** Create a directory (recursively) if it does not exist yet. */
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create every directory the pipeline writes into. */
export function ensureAllDirs() {
  for (const key of ['audio', 'characters', 'assetsCharacters', 'output', 'temp']) {
    ensureDir(PATHS[key]);
  }
}
