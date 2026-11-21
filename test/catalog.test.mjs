import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creatureDetails, shopCard } from '../public/assets/components.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const read = async (name) => JSON.parse(await readFile(path.join(root, 'data', name + '.json')));
const catalog = await read('catalog'),
  commands = await read('commands');
test('all released species have unique names and IDs, original art, lore and valid plot income', async () => {
  const c = catalog.creatures;
  assert.equal(c.length, 250);
  assert.equal(new Set(c.map((x) => x.name)).size, 250);
  assert.equal(new Set(c.map((x) => x.id)).size, 250);
  for (const x of c) {
    assert.ok(
      x.description.length > 14 &&
        x.incomeMax >= x.incomeMin &&
        x.incomeMin > 0 &&
        x.sale > 0 &&
        x.weight > 0
    );
    assert.equal(x.rarity, catalog.rarities[x.tier]);
    assert.ok((await stat(path.join(root, x.image))).size > 0);
    assert.ok(creatureDetails(x, catalog).includes(catalog.eggs[x.tier].name));
  }
});
test('egg timers, tier counts and percentage shares match the playable release', async () => {
  assert.deepEqual(
    catalog.eggs.map((x) => x.hatchSeconds),
    [10, 30, 60, 180, 600, 1800, 3600, 10800, 21600]
  );
  assert.equal(
    catalog.eggs.reduce((n, x) => n + x.spawnPercent, 0),
    100
  );
  for (const egg of catalog.eggs) {
    assert.equal(egg.speciesCount, catalog.creatures.filter((x) => x.tier === egg.tier).length);
    assert.ok(
      egg.description &&
        egg.rank &&
        egg.sources.length &&
        egg.speciesCount === (egg.tier === 8 ? 50 : 25)
    );
    assert.ok((await stat(path.join(root, egg.image))).size > 0);
  }
});
test('the shop covers every family and tier, and all seven cosmetics', async () => {
  assert.deepEqual(
    catalog.cosmetics.map((x) => x.name),
    ['Meadow', 'Midnight', 'Rose', 'Ocean', 'Gold frame', 'Star badge', 'Bloom nameplate']
  );
  assert.equal(catalog.items.length, 50);
  for (const family of new Set(catalog.items.map((x) => x.family))) {
    assert.deepEqual(
      catalog.items.filter((x) => x.family === family).map((x) => x.level),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
  }
  for (const x of [...catalog.items, ...catalog.cosmetics]) {
    assert.ok(x.description && x.price >= 0 && x.name);
    assert.ok((await stat(path.join(root, x.image))).size > 0);
    assert.ok(shopCard(x).includes(x.name));
  }
});
test('the command reference contains exactly the public registered commands', () => {
  const names = [
    'start',
    'help',
    'guide',
    'inventory',
    'incubators',
    'collection',
    'sell',
    'rank',
    'profile view',
    'profile customize',
    'shop',
    'plot view',
    'place',
    'plot place',
    'plot remove',
    'plot expand',
    'plot collect',
    'trade',
    'daily',
    'weekly',
    'monthly',
    'quest',
    'casino slots',
    'casino coinflip',
    'casino blackjack',
    'casino resume',
    'casino rules'
  ].map((s) => '/' + s);
  assert.deepEqual(commands.map((c) => c.name).sort(), names.sort());
  for (const c of commands) {
    assert.ok(c.usage.startsWith(c.name) && c.description && c.category);
    assert.ok(Array.isArray(c.options));
  }
});
test('internal page and artwork links resolve inside the public directory', async () => {
  const pages = [
    'index.html',
    'field-guide/index.html',
    'eggs/index.html',
    'about/index.html',
    'commands/index.html',
    'shop/index.html',
    'updates/index.html',
    'privacy/index.html',
    '404.html'
  ];
  const links = new Set();
  for (const page of pages) {
    const markup = await readFile(path.join(root, page), 'utf8');
    assert.equal((markup.match(/<h1\b/g) || []).length, 1);
    assert.match(markup, /\/assets\/site\.mjs/);
    for (const m of markup.matchAll(/(?:src|srcset|href)="(\/[^"]*)"/g))
      links.add(new URL(m[1], 'https://example.test').pathname);
  }
  const css = await readFile(path.join(root, 'assets/site.css'), 'utf8');
  for (const m of css.matchAll(/url\("(\/[^"]+)"\)/g)) links.add(m[1]);
  for (const link of links) {
    assert.ok(
      (await stat(path.join(root, link, link.endsWith('/') ? 'index.html' : ''))).isFile(),
      link
    );
  }
  const files = await readdir(root, { recursive: true });
  assert.ok(
    !files.some((x) =>
      /(?:^|[\\/])(?:\.env|\.dev\.vars|initial-save|.+\.sqlite3|width-check\.html)$/.test(x)
    )
  );
});
