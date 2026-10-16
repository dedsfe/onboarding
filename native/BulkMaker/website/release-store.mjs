import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export async function latestRelease(directory) {
  let value;
  try { value = JSON.parse(await readFile(resolve(directory, 'latest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!value || value.notarized !== true || value.architecture !== 'arm64'
    || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version)
    || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size <= 0
    || typeof value.url !== 'string' || !value.url.startsWith('/releases/')) return null;
  let name;
  try { name = decodeURIComponent(value.url.slice('/releases/'.length)); } catch { return null; }
  if (name.includes('/') || name.includes('\\') || !name.endsWith('.dmg')) return null;
  const path = resolve(directory, 'releases', name);
  if (!path.startsWith(resolve(directory, 'releases') + sep)) return null;
  try { if ((await stat(path)).size !== value.size) return null; } catch { return null; }
  return value;
}
