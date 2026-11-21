export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export const num = (value) => Number(value).toLocaleString('en-AU');
export const ui = (name, cls = '') =>
  `<img class="pixel-icon ${cls}" src="/assets/ui/${name}.svg" alt="" width="24" height="24">`;
export const discord = `<svg viewBox="0 0 24 24" aria-hidden="true" class="discord-mark"><path fill="currentColor" d="M20.3 4.4a19 19 0 0 0-4.7-1.5l-.6 1.2a17.6 17.6 0 0 0-6 0l-.6-1.2a18.4 18.4 0 0 0-4.7 1.5C.8 8.7 0 12.8.4 16.9a19 19 0 0 0 5.7 2.9l1.2-1.9-1.8-.9.4-.3a14.6 14.6 0 0 0 12.2 0l.4.3-1.8.9 1.2 1.9a19 19 0 0 0 5.7-2.9c.5-4.7-.8-8.9-3.3-12.5ZM8.1 14.6c-1.1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2c1 0 1.9 1 1.9 2.2s-.8 2.2-1.9 2.2Zm7.8 0c-1.1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2c1 0 1.9 1 1.9 2.2s-.8 2.2-1.9 2.2Z"/></svg>`;
export const timing = (seconds) =>
  seconds < 60
    ? `${seconds} sec`
    : seconds < 3600
      ? `${seconds / 60} min`
      : `${seconds / 3600} ${seconds === 3600 ? 'hour' : 'hours'}`;
export const themes = [
  'glacier',
  'grove',
  'glacier',
  'ember',
  'ember',
  'violet',
  'violet',
  'grove',
  'violet'
];
const terrain = (tier) => themes[tier] || 'glacier';
const rarityTag = (x) => `<span class="rarity r${x.tier}"><i></i>${esc(x.rarity)}</span>`;
export function creatureCard(c) {
  return `<a class="creature-card" data-creature="${c.id}" href="/field-guide/?creature=${c.id}" aria-label="Open ${esc(c.name)} field notes">
    <div class="habitat land-${terrain(c.tier)}">${rarityTag(c)}<span class="ground-shadow"></span><img class="critter" src="${esc(c.image)}" alt="" loading="lazy" width="140" height="140"></div>
    <div class="card-copy"><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p></div></a>`;
}
export function eggCard(e) {
  return `<article class="egg-card"><div class="egg-art land-${terrain(e.tier)}">${rarityTag(e)}<img src="${esc(e.image)}" alt="" loading="lazy" width="120" height="120"></div>
    <div class="card-copy"><h2>${esc(e.name)}</h2><p>${esc(e.description)}</p><div class="facts-line">${ui('hourglass')} ${timing(e.hatchSeconds)} <span>·</span> ${e.speciesCount} species</div>
    <details class="egg-details" id="egg-${e.id}"><summary>Hatching notes<span class="chev"></span></summary><div><dl class="pairs"><dt>Wild claim rank</dt><dd>${esc(e.rank)}</dd><dt>Rank upgrade</dt><dd>${e.rankCost ? num(e.rankCost) + ' SB' : 'Starter rank'}</dd><dt>Weekday spawn share</dt><dd>${e.spawnPercent}%</dd></dl>
    <p class="small-label">Where to find it</p><ul>${e.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><a class="text-link" href="/field-guide/?rarity=${encodeURIComponent(e.rarity)}">See the ${esc(e.rarity)} creatures</a></div></details></div></article>`;
}
export function creatureDetails(c, catalog) {
  const e = catalog.eggs[c.tier];
  const total = catalog.creatures.filter((x) => x.tier === c.tier).reduce((n, x) => n + x.weight, 0);
  const odds = ((c.weight * 100) / total).toLocaleString('en-AU', { maximumFractionDigits: 2 });
  return `<div class="record-art land-${terrain(c.tier)}">${rarityTag(c)}<span class="ground-shadow"></span><img src="${esc(c.image)}" alt="${esc(c.name)}" width="164" height="164"></div>
    <div class="record-body"><p class="kicker">CREATURE FIELD NOTES</p><h2 id="record-title">${esc(c.name)}</h2><p class="record-lore">${esc(c.description)}</p>
    <dl class="stat-table"><div><dt>Hatches from</dt><dd><a href="/eggs/#egg-${e.id}">${esc(e.name)}</a></dd></div><div><dt>Base hatch time</dt><dd>${timing(e.hatchSeconds)}</dd></div>
    <div><dt>Plot income per hour</dt><dd>${num(c.incomeMin)}–${num(c.incomeMax)} SB</dd></div><div><dt>Sell value</dt><dd>${num(c.sale)} SB</dd></div><div><dt>Base chance within this egg</dt><dd>${odds}%</dd></div></dl>
    <p class="quiet-note">Each hatch rolls its own permanent income within this range.</p></div>`;
}
const kindLabels = { luck: 'Hatch luck', speed: 'Incubation speed', timer: 'Active timers' };
export function shopCard(x) {
  const cosmetic = !x.family;
  const label = cosmetic ? x.kind : kindLabels[x.kind];
  return `<article class="shop-card"><div class="item-pic ${x.kind === 'Background' ? 'scenic-item' : ''}"><img src="${esc(x.image)}" alt="" loading="lazy" width="80" height="80"></div>
    <div class="item-copy"><p class="small-label">${esc(label)}${cosmetic ? '' : ` · Level ${x.level}`}</p><h3>${esc(x.name)}</h3><p>${esc(x.description)}</p><span class="price"><img class="pixel-icon" src="/assets/catalog/shop/shellbit.webp" alt="" width="18" height="18">${x.price ? num(x.price) + ' SB' : 'Included'}</span></div></article>`;
}
export function commandRow(c) {
  const options = c.options.length
    ? `<dl class="opt-list">${c.options.map((o) => `<div><dt><code>${esc(o.name)}</code> <small>${o.required ? 'Required' : 'Optional'}</small></dt><dd>${esc(o.description)}</dd></div>`).join('')}</dl>`
    : '';
  return `<details class="command-row"><summary><code>${esc(c.name)}</code><span>${esc(c.description)}</span><i class="chev"></i></summary><div class="command-body"><div class="syntax"><code>${esc(c.usage)}</code><button class="copy-code" type="button" data-copy="${esc(c.name)}" aria-label="Copy command ${esc(c.name)}">Copy name</button></div>${options}${c.notes ? `<p>${esc(c.notes)}</p>` : ''}${c.example ? `<p class="example">Try <code>${esc(c.example)}</code></p>` : ''}</div></details>`;
}
export const blank = (message) =>
  `<div class="no-results">${ui('book')}<h3>No matches</h3><p>${esc(message)}</p><button class="btn subtle" type="button" id="clear-filters">Clear filters</button></div>`;
