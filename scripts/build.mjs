// Restore the public artwork and rebuild the pages from the checked-in catalogue.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreArtwork } from './artwork.mjs';
import {
  ui,
  discord,
  esc,
  timing,
  creatureCard,
  eggCard,
  commandRow,
  shopCard
} from '../public/assets/components.mjs';

restoreArtwork();
const root = fileURLToPath(new URL('../public/', import.meta.url));
const read = async (file) => JSON.parse(await readFile(path.join(root, 'data', file), 'utf8'));
const cat = await read('catalog.json'),
  commands = await read('commands.json');
const cats = [...new Set(commands.map((c) => c.category))];
const families = [...new Set(cat.items.map((i) => i.family))];
const featured = [1, 50, 55, 150].map((id) => cat.creatures.find((c) => c.id === id));
const navItems = [
  ['/', 'Home'],
  ['/field-guide/', 'Field guide'],
  ['/commands/', 'Commands'],
  ['/shop/', 'Shop'],
  ['/updates/', 'Updates'],
  ['/about/', 'About']
];
const motion = `<button type="button" class="motion-button" data-motion aria-pressed="false"><span class="motion-icon" aria-hidden="true"></span><span data-motion-label>Pause motion</span></button>`;
const brand = `<img src="/assets/ui/egg-logo.svg" alt="" width="38" height="38"><span>HatchHaven</span>`;
const nav = (active) =>
  navItems
    .map(
      ([route, title]) =>
        `<a href="${route}"${active === route || (active === '/eggs/' && route === '/field-guide/') ? ' aria-current="page"' : ''}>${title}</a>`
    )
    .join('');
const compact = (long, short) =>
  '<span class="wide-copy">' + long + '</span><span class="phone-copy">' + short + '</span>';
const shortButtons = { 'Explore field guide': 'Field guide', 'View commands': 'Commands' };
const button = (href, label, icon, skin = 'gold') =>
  `<a class="btn ${skin}" href="${href}" aria-label="${esc(label)}">${ui(icon)}${shortButtons[label] ? compact(label, shortButtons[label]) : label}</a>`;
const label = (name, icon = 'sparkle') => `<p class="kicker">${ui(icon)}${name}</p>`;
const tab = (a, t, active) =>
  `<a class="page-tab" href="${a}" ${active ? 'aria-current="page"' : ''}>${t}</a>`;
const guideTabs = (egg) =>
  `<nav class="page-tabs" aria-label="Field guide sections">${tab('/field-guide/', ui('paw') + 'Creatures <small>' + cat.creatures.length + '</small>', !egg)}${tab('/eggs/', ui('nest') + 'Eggs <small>' + cat.eggs.length + '</small>', egg)}</nav>`;
const select = (id, title, options) =>
  `<label class="select-label"><span class="visually-hidden">${title}</span><select disabled data-index-control aria-label="${title}" id="${id}">${options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select><i class="chev"></i></label>`;
const search = (place, title = 'Search') =>
  `<label class="search-box"><span aria-hidden="true" class="search-icon"></span><span class="visually-hidden">${title}</span><input disabled data-index-control id="search" type="search" placeholder="${place}" maxlength="120" autocomplete="off"></label>`;
const pager = `<nav class="pager" id="pager" aria-label="Result pages" hidden><button type="button" id="prev">Previous</button><span id="page-label" aria-live="polite"></span><button type="button" id="next">Next</button></nav>`;
const resultHead = (text) => `<p class="result-count" id="result-count" role="status">${text}</p>`;
function mast(kicker, title, desc, scene, icon) {
  return `<section class="mast" aria-labelledby="page-title"><div class="mast-scene scene-${scene} layer-back" aria-hidden="true"></div><div class="mist-layer" aria-hidden="true"></div><div class="floating-stars layer-front" aria-hidden="true"></div><div class="wrap mast-copy">${label(kicker, icon)}<h1 id="page-title">${title}</h1><p class="lede">${desc}</p></div></section>`;
}
function chrome(title, description, route, content) {
  const page = route.replaceAll('/', '') || 'home';
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#141529">
<title>${title === 'HatchHaven' ? title : title + ' · HatchHaven'}</title><meta name="description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<link rel="icon" type="image/svg+xml" href="/assets/ui/egg-logo.svg"><link rel="preload" href="/assets/ui/haven-pixel.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/site.css">
<script type="module" src="/assets/site.mjs"></script></head><body data-page="${page}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap header-row"><a href="/" class="brand" aria-label="HatchHaven home">${brand}</a>
<nav class="main-nav" id="main-nav" aria-label="Main navigation">${nav(route)}</nav>
<div class="header-actions"><button class="discord-button" data-account type="button" aria-label="Connect Discord">${discord}<span class="account-caption"><span data-account-label>Connect</span><span data-connect-suffix> Discord</span></span></button><button class="menu-button" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="Open navigation"><i></i><i></i><i></i></button></div></div></header>
<main id="main">${content}</main>
<footer><div class="wrap footer-top"><div><a class="brand footer-brand" href="/">${brand}</a><p>A creature-collecting game for Discord.</p></div><nav aria-label="Footer links"><a href="/about/">About the bot</a><a href="/commands/">Commands</a><a href="/privacy/">Privacy &amp; sign-in</a></nav>${motion}</div></footer>
<dialog id="site-dialog" aria-labelledby="dialog-title"><div class="dialog-shell"><button type="button" class="x-button" data-close aria-label="Close dialog">×</button><div id="dialog-content"></div></div></dialog>
<dialog id="record-dialog" aria-labelledby="record-title"><div class="dialog-shell"><button type="button" class="x-button" data-close aria-label="Close field notes">×</button><div id="record-content"></div></div></dialog>
<div class="toast" role="status" aria-live="polite" id="toast" hidden></div>
</body></html>`;
}
function metric(n, text, icon, color) {
  return `<div class="metric"><span class="metric-art ${color}">${ui(icon)}</span><span><strong>${n}</strong><span>${compact(text, { 'Collectible creatures': 'Creatures', 'Egg rarities': 'Egg tiers', 'Player commands': 'Commands' }[text])}</span></span></div>`;
}
const home = `<section class="hero" aria-labelledby="home-title"><picture class="hero-art layer-back"><source media="(max-width: 650px)" srcset="/assets/scenery/moonrise-mobile.webp"><img src="/assets/scenery/moonrise.webp" width="2172" height="724" alt="" fetchpriority="high"></picture><div class="hero-shade"></div><div class="floating-stars layer-front" aria-hidden="true"></div>
<div class="wrap hero-inner"><div class="hero-copy">${label('A DISCORD CREATURE COLLECTOR')}<h1 id="home-title">HatchHaven</h1><p>Hatch mysterious eggs, discover rare creatures, and grow your own little corner of the world on Discord.</p>
<div class="hero-actions">${button('/field-guide/', 'Explore field guide', 'book')}${button('/commands/', 'View commands', 'terminal', 'ghost')}</div></div></div><div class="hero-motion">${motion}</div></section>
<section class="stat-strip" aria-label="HatchHaven in numbers"><div class="wrap stat-inner">${metric(cat.creatures.length, 'Collectible creatures', 'paw', 'mint')}${metric(cat.eggs.length, 'Egg rarities', 'nest', 'amethyst')}${metric(commands.length, 'Player commands', 'terminal', 'golden')}</div></section>
<section class="wrap section spotlight"><div class="section-heading"><div>${label('FIELD NOTES', 'sprig')}<h2>Creature spotlight</h2></div><a class="section-link" href="/field-guide/" aria-label="Full field guide">${compact('Full field guide', 'View all')} <span class="link-chevron" aria-hidden="true"></span></a></div>
<div class="creature-grid">${featured.map(creatureCard).join('')}</div></section>
<section class="wrap section home-eggs"><div class="egg-banner"><div class="egg-banner-copy">${label('EGG GUIDE', 'nest')}<h2>Inside the shell</h2><p>A Common egg hatches in ten seconds. An Eternal egg takes six hours and holds one of fifty fantasy creatures.</p>${button('/eggs/', 'Explore egg rarities', 'nest', 'subtle')}</div>
<div class="egg-lineup">${[1, 4, 8].map((t) => `<a href="/eggs/#egg-${t}"><img loading="lazy" src="${cat.eggs[t].image}" width="92" height="92" alt=""><span>${cat.eggs[t].rarity}</span></a>`).join('')}</div></div></section>`;

const creatures =
  mast(
    'THE FIELD GUIDE',
    'Creature field guide',
    `Meet all ${cat.creatures.length} animals. Open a field note for its lore, hatch odds, sale value, and plot income.`,
    'library',
    'book'
  ) +
  `<section class="wrap section browse">${guideTabs(false)}<div class="toolbar">${search('Search creatures…', 'Search creatures')}${select('rarity', 'Rarity', [['', 'All rarities'], ...cat.rarities.map((x) => [x, x])])}${select(
    'sort',
    'Sort creatures',
    [
      ['guide', 'Guide order'],
      ['az', 'Name A–Z'],
      ['income', 'Highest income']
    ]
  )}</div>
${resultHead('Browse the collection')}<div class="creature-grid" id="results">${cat.creatures
    .filter((c) => c.tier === 0)
    .slice(0, 16)
    .map(creatureCard)
    .join('')}</div>${pager}
<noscript><h2>Complete creature index</h2><dl class="simple-index">${cat.creatures.map((c) => `<dt>${esc(c.name)} · ${c.rarity}</dt><dd>${esc(c.description)}</dd>`).join('')}</dl></noscript></section>`;

const eggs =
  mast(
    'THE FIELD GUIDE',
    'Egg guide',
    'See what each shell holds, how long it takes to hatch, and which rank can claim it in the wild.',
    'hatchery',
    'nest'
  ) +
  `<section class="wrap section browse">${guideTabs(true)}<p class="info-line">${ui('hourglass')}<span>From Saturday through Sunday in Sydney, Epic and higher eggs receive 1.2× their usual spawn weight.</span></p><div class="egg-grid">${cat.eggs.map(eggCard).join('')}</div></section>`;

const commandPage =
  mast(
    'PLAYER HANDBOOK',
    'Command reference',
    'Find a slash command, check its arguments, and copy its name into Discord.',
    'library',
    'terminal'
  ) +
  `<section class="wrap section browse"><div class="toolbar">${search('Search player commands…', 'Search player commands')}${select('category', 'Command category', [['', 'All categories'], ...cats.map((x) => [x, x])])}</div>${resultHead(commands.length + ' player commands')}
<div id="results">${cats
    .map(
      (c) =>
        `<section class="command-group"><h2>${esc(c)}</h2>${commands
          .filter((x) => x.category === c)
          .map(commandRow)
          .join('')}</section>`
    )
    .join('')}</div></section>`;

const shop =
  mast(
    'THE TRADING POST',
    'Item shop',
    'Compare supplies and cosmetics before spending Shellbits in Discord.',
    'store',
    'coins'
  ) +
  `<section class="wrap section browse"><div class="shop-info">${ui('coins')}<p>Open <code>/shop</code> in Discord to buy supplies. Choose <strong>My item bag</strong> to activate them or <strong>Cosmetics</strong> to equip a design.</p></div>
<div class="page-tabs shop-tabs" role="group" aria-label="Shop sections"><button disabled data-index-control type="button" data-shop-tab="supplies" aria-pressed="true">${ui('sprig')}Supplies <small>${cat.items.length}</small></button><button disabled data-index-control type="button" data-shop-tab="cosmetics" aria-pressed="false">${ui('crystal')}Cosmetics <small>${cat.cosmetics.length}</small></button></div>
<div class="toolbar">${search('Search shop items…', 'Search shop items')}${select('family', 'Item family', [['', 'All families'], ...families.map((x) => [x, x])])}${select(
    'sort',
    'Sort items',
    [
      ['guide', 'Shop order'],
      ['low', 'Lowest price'],
      ['high', 'Highest price']
    ]
  )}</div>${resultHead('Browse shop stock')}<div class="shop-grid" id="results">${cat.items.slice(0, 12).map(shopCard).join('')}</div>${pager}
<noscript><h2>Full shop stock</h2><div class="shop-grid">${[...cat.items, ...cat.cosmetics].map(shopCard).join('')}</div></noscript></section>`;

function step(icon, title, content) {
  return `<article class="step"><span class="step-icon">${ui(icon)}</span><h3>${title}</h3><p>${content}</p></article>`;
}
const about =
  mast(
    'ABOUT THE BOT',
    'Welcome to the haven',
    'HatchHaven is a Discord game about finding eggs, raising animals, and giving each new discovery a place on your plot.',
    'midnight',
    'lantern'
  ) +
  `<section class="wrap section"><div class="story"><img class="story-img" src="/assets/scenery/hatchery.webp" alt="An egg-lined greenhouse inside the HatchHaven hatchery" width="624" height="420"><div>${label('YOUR FIRST HATCH', 'nest')}<h2>From egg to homestead</h2><p>Type <code>/start</code> in a server that has HatchHaven. You’ll receive three Common eggs, ten incubators, and a small plot. Open <code>/incubators</code>, choose <strong>Start waiting eggs</strong>, then <strong>Collect ready hatches</strong> when their timers finish.</p><p>Your first animal could be a familiar farmyard friend. Higher ranks open up wild eggs with crystal stags, ember phoenixes, and stranger discoveries.</p>${button('/commands/', 'Find a command', 'terminal', 'subtle')}</div></div>
<div class="section-heading inner-heading"><h2>Life in the haven</h2></div><div class="steps">${step('nest', 'Find wild eggs', 'Chat in a server channel with egg spawns enabled. When an egg appears, use its Steal button. Your collector rank determines which wild tiers you can claim.')}${step('sprig', 'Grow your plot', 'Place animals on owned tiles to earn Shellbits. Each copy has its own hourly rate. Use <code>/plot collect</code> to bank up to twelve hours of earnings.')}${step('book', 'Keep a field journal', 'Your collection remembers every species you discover, even after a trade or sale. Use <code>/collection</code> to revisit the journal and <code>/trade</code> to exchange animals with friends.')}</div>
<div class="note-panel">${ui('lantern')}<p>Your animals, plot, and Shellbits belong to the Discord server where you play. Website sign-in identifies you on this site. Your game inventory stays with the bot.</p></div></section>`;

const updates =
  mast(
    'THE NOTICEBOARD',
    'Potential updates',
    'Ideas for future seasons, limited companions, and ways to earn them. These concepts are open for discussion.',
    'rose',
    'lantern'
  ) +
  `<section class="wrap section"><div class="section-heading"><div>${label('SEASONAL CONCEPTS', 'sprig')}<h2>Limited companion ideas</h2></div></div>
<div class="ideas">${[
    [
      'rose',
      'Lantern festival',
      'Lantern-tail Tanuki',
      'An anime-inspired night market. Complete lantern deliveries to earn festival stamps, then trade a full card for this paper-lantern companion.'
    ],
    [
      'meadow',
      'Storybook season',
      'Glasswing Fawn',
      'A woodland fawn whose glass antlers catch the sunrise. Gather lost story pages through weekly quests to finish its illustrated chapter.'
    ],
    [
      'midnight',
      'Midnight matinee',
      'Starlight Projector Cat',
      'A little cinema cat with a tail like a reel of film. Complete a set of movie-night challenges to redeem the companion.'
    ]
  ]
    .map(
      ([scene, season, name, copy]) =>
        `<article class="idea"><img src="/assets/scenery/${scene}.webp" loading="lazy" alt="" width="624" height="420"><div><p class="small-label">${season}</p><h3>${name}</h3><p>${copy}</p></div></article>`
    )
    .join('')}</div>
<div class="split-articles"><article>${ui('coins')}<h2>Earn it or buy it directly</h2><p>One proposed model gives every limited pet a visible quest target and a guaranteed redemption. Players who prefer a shortcut could buy that same named pet at a fixed price. Both versions would have the same appearance and stats.</p><p>The current game uses fictional Shellbits. These proposals have no checkout, release date, or active paid rewards.</p></article>
<article>${ui('crystal')}<h2>Guest collections</h2><p>Anime, Disney stories, Pokémon, and movie worlds are possible themes for a licensed guest season. A crossover would need an agreement with the rights holder before characters or artwork could appear.</p><p>The three concepts above are original HatchHaven ideas. They have no announced partners.</p></article></div></section>`;

const privacy =
  mast(
    'ACCOUNT HELP',
    'Privacy &amp; sign-in',
    'How HatchHaven uses your Discord identity and what happens when you sign out.',
    'moonrise',
    'book'
  ) +
  `<section class="wrap section reading"><h2>What Discord shares</h2><p>The connect button opens Discord’s own consent screen. The site requests the <code>identify</code> permission to read your Discord user ID, username, and display name. Enter your Discord password only on Discord’s own sign-in page.</p>
<h2>Your website session</h2><p>Cloudflare stores those three identity fields in a short-lived website session. A random cookie connects your browser to the session. The login attempt expires in ten minutes. A successful session lasts up to eight hours. Signing out removes it immediately.</p>
<p>Discord access and refresh tokens stay out of browser storage and are discarded by the website after the identity lookup. The motion preference is saved only in this browser.</p>
<h2>Your game progress</h2><p>The bot keeps its own server-specific game saves. The website hosts the public catalogue. Signing in lets the site recognise your Discord identity while your inventory, trades, and Shellbits stay in Discord.</p>
<h2>Disconnect your account</h2><p>Select your account in the header and choose <strong>Sign out</strong>. To withdraw the Discord permission, open Discord’s <strong>User Settings → Authorized Apps</strong>, select the website’s app, and deauthorize it. Signing out here also clears an existing website session.</p></section>`;
const missing =
  mast(
    'FIELD GUIDE',
    'Page not found',
    'That path leads out of the haven. Return home or open the field guide to keep exploring.',
    'moonrise',
    'lantern'
  ) +
  `<section class="wrap section hero-actions">${button('/', 'Return home', 'egg-logo')}${button('/field-guide/', 'Field guide', 'book', 'subtle')}</section>`;
const pages = [
  [
    '/',
    'HatchHaven',
    'The illustrated field guide to HatchHaven, a creature-collecting Discord game.',
    home
  ],
  [
    '/field-guide/',
    'Creature field guide',
    'Explore all 250 HatchHaven creatures, with original artwork, lore and stats.',
    creatures
  ],
  ['/eggs/', 'Egg guide', 'Explore all nine HatchHaven egg tiers, timers and collector ranks.', eggs],
  [
    '/commands/',
    'Commands',
    'Find all 27 player slash commands and learn how to use them.',
    commandPage
  ],
  ['/shop/', 'Item shop', 'Browse HatchHaven supplies, cosmetics and Shellbit prices.', shop],
  ['/about/', 'About HatchHaven', 'Learn how to start playing HatchHaven on Discord.', about],
  [
    '/updates/',
    'Potential updates',
    'Explore ideas for future limited companions and seasons.',
    updates
  ],
  [
    '/privacy/',
    'Privacy & sign-in',
    'Learn about the website’s Discord sign-in and session cookies.',
    privacy
  ],
  ['/404/', 'Page not found', 'Find your way back to HatchHaven.', missing]
];
for (const [route, title, desc, content] of pages) {
  const output =
    route === '/404/' ? path.join(root, '404.html') : path.join(root, route.slice(1), 'index.html');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, chrome(title, desc, route, content));
}
console.log('Built ' + pages.length + ' HTML pages.');
