// Store the public art compactly in Git. Restore its original URLs during each build.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const assetRoot = fileURLToPath(new URL('../public/assets/', import.meta.url));
const packRoot = fileURLToPath(new URL('../artwork/', import.meta.url));
const names = ['creatures-1', 'creatures-2', 'world'];
const folders = ['catalog/creatures', 'catalog/eggs', 'catalog/shop', 'scenery', 'ui'];
const assetName = /^(?:catalog\/(?:creatures|eggs)\/\d+\.webp|catalog\/shop\/[\w-]+\.webp|scenery\/[\w-]+\.(?:webp|png)|ui\/(?:[\w-]+\.(?:svg|woff2)|PERMISSIONS\.txt))$/;

function packPath(name) {
  return join(packRoot, name + '.json.gz');
}

function writeIfChanged(file, bytes) {
  if (existsSync(file) && readFileSync(file).equals(bytes)) return;
  mkdirSync(dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function verifyCatalog(assets) {
  const catalog = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
  for (const entry of [...catalog.creatures, ...catalog.eggs, ...catalog.items, ...catalog.cosmetics]) {
    const name = entry.image.replace(/^\/assets\//, '');
    if (!assets.has(name)) throw new Error('Missing artwork for ' + entry.name + ': ' + entry.image);
  }
}

export function restoreArtwork() {
  const assets = new Map();
  for (const name of names) {
    const file = packPath(name);
    if (!existsSync(file)) {
      throw new Error('Missing artwork/' + name + '.json.gz. Upload the complete artwork folder from the website ZIP.');
    }
    const pack = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
    if (pack.version !== 1 || pack.name !== name || !Array.isArray(pack.files) || !pack.files.length) {
      throw new Error('Invalid artwork pack: ' + name);
    }
    for (const [path, data] of pack.files) {
      if (typeof path !== 'string' || !assetName.test(path) || typeof data !== 'string' || !data.length || assets.has(path)) {
        throw new Error('Invalid or duplicate artwork path in ' + name + ': ' + path);
      }
      assets.set(path, Buffer.from(data, 'base64'));
    }
  }
  verifyCatalog(assets);
  for (const [path, bytes] of assets) writeIfChanged(join(assetRoot, path), bytes);
  console.log('Restored ' + assets.size + ' artwork files.');
}

function packArtwork() {
  const groups = folders.map((folder) =>
    readdirSync(join(assetRoot, folder), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => folder + '/' + entry.name)
      .filter((path) => assetName.test(path))
      .sort()
  );
  const [creatures, ...worldGroups] = groups;
  creatures.sort((a, b) => Number.parseInt(a.split('/').pop(), 10) - Number.parseInt(b.split('/').pop(), 10));
  const midpoint = Math.ceil(creatures.length / 2);
  const pathsByPack = [creatures.slice(0, midpoint), creatures.slice(midpoint), worldGroups.flat()];
  verifyCatalog(new Set(pathsByPack.flat()));
  const encoded = pathsByPack.map((paths, i) => {
    if (!paths.length) throw new Error('Empty artwork group: ' + names[i]);
    const files = paths.map((path) => [path, readFileSync(join(assetRoot, path)).toString('base64')]);
    return gzipSync(JSON.stringify({ version: 1, name: names[i], files }), { level: 9 });
  });
  names.forEach((name, i) => writeIfChanged(packPath(name), encoded[i]));
  console.log('Packed ' + groups.flat().length + ' artwork files into artwork/.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'pack') packArtwork();
  else restoreArtwork();
}
