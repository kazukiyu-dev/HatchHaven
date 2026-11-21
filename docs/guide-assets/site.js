import {
  esc,
  ui,
  discord,
  blank,
  creatureCard,
  creatureDetails,
  shopCard,
  commandRow
} from './components.js';

const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const page = document.body.dataset.page;
const pagesRoot = document.querySelector('meta[name="hatchhaven-pages"]')?.content;

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = false;
try {
  motionPaused = localStorage.getItem('hh-motion') === 'off';
} catch {
  /* Browser storage may be disabled. */
}
let queued = false;
const moving = new Set();
const visible =
  'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) e.isIntersecting ? moving.add(e.target) : moving.delete(e.target);
        queueScene();
      })
    : null;
function registerScene() {
  for (const node of moving)
    if (!node.isConnected) {
      visible?.unobserve(node);
      moving.delete(node);
    }
  for (const node of all(
    '.critter,.egg-art>img,.item-pic>img,.step-icon>img,.story-img,.egg-lineup img'
  )) {
    if (node.dataset.layer) continue;
    node.dataset.layer = 'sprite';
    visible?.observe(node);
  }
  queueScene();
}
function queueScene() {
  if (queued || motionPaused || reduced.matches) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (motionPaused || reduced.matches) return;
    const offset = Math.min(Math.max(window.scrollY, 0), 570);
    const style = document.documentElement.style;
    style.setProperty('--back-y', Math.round(offset * 0.16) + 'px');
    style.setProperty('--front-y', Math.round(-offset * 0.14) + 'px');
    const changes = [...moving]
      .filter((n) => n.isConnected)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const position = (innerHeight / 2 - rect.top - rect.height / 2) / Math.max(innerHeight, 1);
        return [node, Math.max(-5, Math.min(5, Math.round(position * 9)))];
      });
    for (const [node, drift] of changes) node.style.setProperty('--drift', drift + 'px');
  });
}
function setMotion() {
  const off = motionPaused || reduced.matches;
  document.documentElement.dataset.motion = off ? 'off' : 'on';
  for (const b of all('[data-motion]')) {
    b.setAttribute('aria-pressed', String(off));
    b.disabled = reduced.matches;
    b.querySelector('[data-motion-label]').textContent = reduced.matches
      ? 'Reduced motion'
      : off
        ? 'Enable motion'
        : 'Pause motion';
  }
  queueScene();
}
for (const b of all('[data-motion]'))
  b.addEventListener('click', () => {
    motionPaused = !motionPaused;
    try {
      localStorage.setItem('hh-motion', motionPaused ? 'off' : 'on');
    } catch {
      /* Session-only preference. */
    }
    setMotion();
  });
reduced.addEventListener('change', setMotion);
addEventListener('scroll', queueScene, { passive: true });
addEventListener('resize', queueScene, { passive: true });
setMotion();
registerScene();

const menu = $('.menu-button'),
  nav = $('#main-nav');
function toggleMenu(open) {
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  nav.classList.toggle('open', open);
}
menu.addEventListener('click', () => toggleMenu(menu.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    toggleMenu(false);
    menu.focus();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.site-header')) toggleMenu(false);
});
matchMedia('(min-width:901px)').addEventListener('change', () => toggleMenu(false));

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 6200);
}
for (const dialog of all('dialog')) {
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === dialog && !e.target.closest('.dialog-shell')))
      dialog.close();
  });
}
const accountDialog = $('#site-dialog');
let accountRequest;
async function pagesAccount() {
  try {
    const response = await fetch(pagesRoot + 'discord-site.json', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5500) });
    if (response.ok) {
      const settings = await response.json();
      if (typeof settings.origin === 'string' && settings.origin.trim()) {
        const url = new URL(settings.origin.trim());
        if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && url.origin !== location.origin) {
          return { guide: true, origin: url.origin };
        }
      }
    }
  } catch {
    // The public catalogue is also available before an account site is configured.
  }
  return { guide: true };
}
async function account() {
  if (accountRequest) return accountRequest;
  accountRequest = (async () => {
    try {
      const r = await fetch('/api/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(5500)
      });
      if (!r.ok) return { problem: true };
      const data = await r.json();
      for (const button of all('[data-account]')) {
        button.querySelector('[data-account-label]').textContent = data.user?.displayName || 'Connect';
        button.querySelector('[data-connect-suffix]').hidden = !!data.user;
        button.setAttribute(
          'aria-label',
          data.user ? 'Account for ' + data.user.displayName : 'Connect Discord'
        );
      }
      return data;
    } catch {
      return { problem: true };
    }
  })().finally(() => {
    accountRequest = undefined;
  });
  return accountRequest;
}
function accountBody(data) {
  const privacy = '<a class="text-link" href="/HatchHaven/privacy/">Privacy &amp; sign-in</a>';
  const top = `<div class="dialog-body">${labelAccount()}`;
  if (data.guide) {
    const body = data.origin
      ? `<p>Open the HatchHaven account site and choose <strong>Connect Discord</strong> there to sign in.</p><a class="btn gold" href="${esc(data.origin)}">Open HatchHaven account site</a>`
      : '<p>The HatchHaven account site has not been connected yet. You can explore the full guide here.</p>';
    return top + `<h2 id="dialog-title">Discord sign-in</h2>${body}${privacy}</div>`;
  }
  if (data.problem)
    return (
      top +
      `<h2 id="dialog-title">Connection interrupted</h2><p>The sign-in service could not be reached. Close this window and try again in a moment.</p>${privacy}</div>`
    );
  if (data.user)
    return (
      top +
      `<h2 id="dialog-title">${esc(data.user.displayName)}</h2><p>Connected as <strong>@${esc(data.user.username)}</strong>. Your game collection lives in Discord.</p><form action="/auth/logout" method="post"><button class="btn subtle" type="submit">Sign out</button></form>${privacy}</div>`
    );
  if (!data.enabled)
    return (
      top +
      `<h2 id="dialog-title">Discord sign-in</h2><p>Sign-in is awaiting the site owner’s Discord and Cloudflare settings. The full field guide is available to explore.</p><a class="btn gold" href="/HatchHaven/field-guide/">${ui('book')}Browse the field guide</a>${privacy}</div>`
    );
  const back = [
    '/',
    '/field-guide/',
    '/eggs/',
    '/shop/',
    '/about/',
    '/commands/',
    '/updates/',
    '/privacy/'
  ].includes(location.pathname)
    ? location.pathname
    : '/';
  return (
    top +
    `<h2 id="dialog-title">Connect Discord</h2><p>Continue to Discord to confirm your account. HatchHaven asks for your basic Discord identity. Your password stays on Discord.</p><form method="post" action="/auth/login?return_to=${encodeURIComponent(back)}"><button type="submit" class="btn gold">${discord}Continue to Discord</button></form>${privacy}</div>`
  );
}
function labelAccount() {
  return `<p class="kicker">${ui('egg-logo')}HATCHHAVEN ACCOUNT</p>`;
}
for (const node of all('[data-account]'))
  node.addEventListener('click', async () => {
    const content = $('#dialog-content');
    content.innerHTML = `<div class="dialog-body"><h2 id="dialog-title">Discord sign-in</h2><p role="status">Checking your connection…</p></div>`;
    accountDialog.showModal();
    content.innerHTML = accountBody(await (pagesRoot ? pagesAccount() : account()));
  });
if (!pagesRoot) {
  account();
  addEventListener('pageshow', (e) => {
    if (e.persisted) account();
  });
}
const messages = {
  busy: 'Several sign-ins were started recently. Try again in a minute.',
  cancelled: 'Discord sign-in was cancelled.',
  expired: 'This sign-in link has expired. Connect Discord to start again.',
  failed: 'Discord sign-in could not finish. Please try again.',
  signedout: 'You have signed out.'
};
const initial = new URL(location.href);
if (initial.searchParams.has('login')) {
  const value = initial.searchParams.get('login');
  if (Object.hasOwn(messages, value)) toast(messages[value]);
  initial.searchParams.delete('login');
  history.replaceState(history.state, '', initial);
}
async function load(name) {
  const r = await fetch(new URL(name + '.json', import.meta.url));
  if (!r.ok) throw Error('Catalogue unavailable');
  return r.json();
}
const norm = (x) =>
  String(x || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
function setQuery(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, String(value));
  else url.searchParams.delete(key);
  history.replaceState(history.state, '', url);
}
function selectValue(node, value) {
  if (!node) return;
  node.value = [...node.options].some((o) => o.value === value) ? value : node.options[0].value;
}
async function setupBrowser() {
  const isCreature = page === 'field-guide',
    isShop = page === 'shop';
  const data = await load(page === 'commands' ? 'commands' : 'catalog');
  const result = $('#results'),
    query = $('#search'),
    sort = $('#sort'),
    family = $('#family'),
    rarity = $('#rarity'),
    category = $('#category');
  const pager = $('#pager'),
    record = $('#record-dialog');
  let tab = 'supplies',
    current = 1,
    max = 1;
  const size = isShop ? 12 : 16;
  function shopControls(selected) {
    tab = selected === 'cosmetics' ? 'cosmetics' : 'supplies';
    const groups =
      tab === 'supplies'
        ? [...new Set(data.items.map((x) => x.family))]
        : [...new Set(data.cosmetics.map((x) => x.kind))];
    family.innerHTML =
      `<option value="">${tab === 'supplies' ? 'All families' : 'All cosmetic types'}</option>` +
      groups.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    for (const b of all('[data-shop-tab]'))
      b.setAttribute('aria-pressed', String(b.dataset.shopTab === tab));
  }
  function restore() {
    const params = new URLSearchParams(location.search);
    query.value = (params.get('q') || '').slice(0, 120);
    if (isShop) shopControls(params.get('tab'));
    selectValue(rarity, params.get('rarity'));
    selectValue(sort, params.get('sort'));
    selectValue(family, params.get('family'));
    selectValue(category, params.get('category'));
    current = Math.max(1, parseInt(params.get('page'), 10) || 1);
  }
  function render() {
    const term = norm(query.value.trim());
    let rows, label;
    if (isCreature) {
      rows = data.creatures.filter(
        (x) =>
          (!rarity.value || x.rarity === rarity.value) &&
          norm([x.name, x.rarity, x.description].join(' ')).includes(term)
      );
      const s = sort.value;
      rows.sort((a, b) =>
        s === 'az'
          ? a.name.localeCompare(b.name)
          : s === 'income'
            ? b.incomeMax - a.incomeMax || a.id - b.id
            : a.tier - b.tier || a.id - b.id
      );
      label = 'creatures';
    } else if (isShop) {
      rows = (tab === 'supplies' ? data.items : data.cosmetics).filter(
        (x) =>
          (!family.value || family.value === (x.family || x.kind)) &&
          norm([x.name, x.kind, x.description].join(' ')).includes(term)
      );
      if (sort.value === 'low') rows.sort((a, b) => a.price - b.price);
      if (sort.value === 'high') rows.sort((a, b) => b.price - a.price);
      label = tab === 'supplies' ? 'supplies' : 'cosmetics';
    } else {
      rows = data.filter(
        (x) =>
          (!category.value || category.value === x.category) &&
          norm(
            [x.name, x.category, x.description, x.usage, x.notes, ...x.options.map((o) => o.name)].join(
              ' '
            )
          ).includes(term)
      );
      label = 'player commands';
    }
    if (rows.length === 1)
      label = {
        creatures: 'creature',
        supplies: 'supply',
        cosmetics: 'cosmetic',
        'player commands': 'player command'
      }[label];
    if (pager) {
      max = Math.max(1, Math.ceil(rows.length / size));
      current = Math.min(current, max);
      const start = (current - 1) * size,
        part = rows.slice(start, start + size);
      $('#result-count').textContent = rows.length
        ? `Showing ${start + 1}–${start + part.length} of ${rows.length} ${label}`
        : `0 ${label}`;
      result.innerHTML = part.length
        ? part.map(isCreature ? creatureCard : shopCard).join('')
        : blank('Try another name or change a filter.');
      pager.hidden = rows.length <= size;
      $('#page-label').textContent = `Page ${current} of ${max}`;
      $('#prev').disabled = current <= 1;
      $('#next').disabled = current >= max;
      registerScene();
    } else {
      $('#result-count').textContent = `${rows.length} ${label}`;
      const groups = [...new Set(rows.map((c) => c.category))];
      result.innerHTML = rows.length
        ? groups
            .map(
              (group) =>
                `<section class="command-group"><h2>${esc(group)}</h2>${rows
                  .filter((c) => c.category === group)
                  .map(commandRow)
                  .join('')}</section>`
            )
            .join('')
        : blank('Try a different command name or category.');
    }
  }
  function changed(key, value) {
    current = 1;
    setQuery('page', '');
    setQuery(key, value);
    render();
  }
  query.addEventListener('input', () => changed('q', query.value.trim()));
  for (const [key, node] of [
    ['rarity', rarity],
    ['family', family],
    ['category', category],
    ['sort', sort]
  ])
    if (node)
      node.addEventListener('change', () => changed(key, node.value === 'guide' ? '' : node.value));
  for (const b of all('[data-shop-tab]'))
    b.addEventListener('click', () => {
      if (b.dataset.shopTab === tab) return;
      shopControls(b.dataset.shopTab);
      query.value = '';
      setQuery('q', '');
      setQuery('family', '');
      changed('tab', tab === 'supplies' ? '' : tab);
    });
  if (pager)
    for (const [id, dir] of [
      ['prev', -1],
      ['next', 1]
    ])
      $('#' + id).addEventListener('click', () => {
        current = Math.max(1, Math.min(max, current + dir));
        setQuery('page', current === 1 ? '' : current);
        render();
        $('#result-count').scrollIntoView({ block: 'start' });
      });
  async function copy(btn) {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast(btn.dataset.copy + ' copied.');
    } catch {
      toast('Select the command name and use your device’s Copy action.');
    }
  }
  function syncRecord() {
    if (!isCreature) return;
    const raw = new URLSearchParams(location.search).get('creature');
    const c =
      raw !== null && /^\d{1,6}$/.test(raw)
        ? data.creatures.find((x) => x.id === Number(raw))
        : undefined;
    if (!c) {
      if (record.open) record.close();
      if (raw !== null) setQuery('creature', '');
      return;
    }
    $('#record-content').innerHTML = creatureDetails(c, data);
    if (!record.open) record.showModal();
  }
  let lastRecordTrigger = null;
  result.addEventListener('click', (e) => {
    if (e.target.closest('#clear-filters')) {
      query.value = '';
      if (isShop) shopControls(tab);
      for (const n of [sort, rarity, family, category]) if (n) n.selectedIndex = 0;
      for (const key of ['q', 'rarity', 'family', 'category', 'sort', 'page']) setQuery(key, '');
      current = 1;
      render();
      query.focus();
      return;
    }
    const btn = e.target.closest('[data-copy]');
    if (btn) {
      copy(btn);
      return;
    }
    const link = e.target.closest('[data-creature]');
    if (link && isCreature && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      lastRecordTrigger = link;
      const url = new URL(location.href);
      url.searchParams.set('creature', link.dataset.creature);
      history.pushState({ hhRecord: true }, '', url);
      syncRecord();
    }
  });
  record.addEventListener('close', () => {
    if (!isCreature) return;
    if (new URLSearchParams(location.search).has('creature')) {
      if (history.state?.hhRecord) history.back();
      else setQuery('creature', '');
    }
    if (lastRecordTrigger?.isConnected) lastRecordTrigger.focus({ preventScroll: true });
  });
  addEventListener('popstate', () => {
    restore();
    render();
    syncRecord();
    if (lastRecordTrigger && !record.open) {
      const id = lastRecordTrigger.dataset.creature;
      result.querySelector('[data-creature="' + id + '"]')?.focus({ preventScroll: true });
      lastRecordTrigger = null;
    }
  });
  restore();
  render();
  syncRecord();
  for (const control of all('[data-index-control]')) control.disabled = false;
}
if (['field-guide', 'shop', 'commands'].includes(page)) {
  setupBrowser().catch(() => {
    toast('The full index could not load. Refresh the page to try again.');
  });
}
if (page === 'eggs') {
  const reveal = () => {
    const id = location.hash.slice(1);
    if (/^egg-[0-8]$/.test(id)) {
      const d = document.getElementById(id);
      d.open = true;
      d.closest('article').scrollIntoView({ block: 'center' });
    }
  };
  reveal();
  addEventListener('hashchange', reveal);
}
