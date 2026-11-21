export { AuthVault } from './vault.mjs';

const ISSUE = 'https://discord.com';
const TOKEN = ISSUE + '/api/oauth2/token';
const IDENTITY = ISSUE + '/api/v10/users/@me';
const FLOW = '__Host-hh_flow';
const SESSION = '__Host-hh_session';
const FLOW_TTL = 600;
const SESSION_TTL = 8 * 3600;
const validKey = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
const publicPages = new Set([
  '/',
  '/about/',
  '/commands/',
  '/field-guide/',
  '/eggs/',
  '/shop/',
  '/updates/',
  '/privacy/'
]);
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex'
};
function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...privateHeaders, ...extra } });
}
function cookie(name, value, ttl) {
  return name + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + ttl;
}
function cookieValue(request, name) {
  const values = (request.headers.get('Cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && validKey(values[0]) ? values[0] : null;
}
function redirect(location, cookies = []) {
  const headers = new Headers({ ...privateHeaders, Location: location });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
const randomKey = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (value) =>
  base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

function configured(env, url) {
  return (
    url.protocol === 'https:' &&
    env.SITE_ORIGIN === url.origin &&
    /^\d{15,22}$/.test(env.DISCORD_CLIENT_ID || '') &&
    typeof env.DISCORD_CLIENT_SECRET === 'string' &&
    env.DISCORD_CLIENT_SECRET.trim().length > 0 &&
    !!env.AUTH_VAULT &&
    !!env.AUTH_RATE
  );
}
async function vault(env, kind, key, path, data) {
  const id = env.AUTH_VAULT.idFromName(kind + ':' + (await digest(key)));
  const response = await env.AUTH_VAULT.get(id).fetch(
    'https://vault.internal/' + path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }
  );
  if (!response.ok && response.status !== 404) throw new Error('Identity storage unavailable');
  return response;
}
async function create(env, kind, key, body) {
  const response = await vault(env, kind, key, 'create', { ...body, kind });
  if (response.status !== 204) throw new Error('Identity storage unavailable');
}
async function clear(env, kind, key) {
  if (key) await vault(env, kind, key, 'clear', {});
}
async function start(request, env) {
  const client = request.headers.get('CF-Connecting-IP') || 'local';
  const limit = await env.AUTH_RATE.limit({ key: 'hatchhaven:login:' + (await digest(client)) });
  if (!limit.success) return redirect('/?login=busy');
  const path = new URL(request.url).searchParams.get('return_to');
  const key = randomKey(),
    state = randomKey(),
    verifier = randomKey();
  await clear(env, 'flow', cookieValue(request, FLOW));
  await create(env, 'flow', key, {
    state,
    verifier,
    back: publicPages.has(path) ? path : '/',
    expires: Date.now() + FLOW_TTL * 1000
  });
  const auth = new URL('/oauth2/authorize', ISSUE);
  auth.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: 'identify',
    response_type: 'code',
    redirect_uri: env.SITE_ORIGIN + '/auth/callback',
    state,
    code_challenge: await digest(verifier),
    code_challenge_method: 'S256'
  }).toString();
  return redirect(auth.href, [cookie(FLOW, key, FLOW_TTL)]);
}
function one(query, field) {
  const values = query.getAll(field);
  return values.length === 1 ? values[0] : null;
}
async function callback(request, url, env, fetcher) {
  const key = cookieValue(request, FLOW),
    state = one(url.searchParams, 'state');
  const clearFlow = cookie(FLOW, '', 0);
  const issue = one(url.searchParams, 'iss');
  // Leave a legitimate pending flow intact when the incoming callback cannot identify it.
  if (!key || !validKey(state) || (url.searchParams.has('iss') && issue !== ISSUE))
    return redirect('/?login=expired');
  const used = await vault(env, 'flow', key, 'consume', { state });
  if (used.status === 404) return redirect('/?login=expired');
  const flow = await used.json();
  const code = one(url.searchParams, 'code');
  const back = flow.back;
  if (url.searchParams.has('error')) {
    const detail = one(url.searchParams, 'error') === 'access_denied' ? 'cancelled' : 'failed';
    return redirect(back + '?login=' + detail, [clearFlow]);
  }
  if (!code || code.length > 512) return redirect(back + '?login=failed', [clearFlow]);
  try {
    const exchange = await fetcher(TOKEN, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(9000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: env.SITE_ORIGIN + '/auth/callback',
        code_verifier: flow.verifier,
        code
      })
    });
    if (!exchange.ok) return redirect(back + '?login=failed', [clearFlow]);
    const grant = await exchange.json();
    if (
      String(grant.token_type).toLowerCase() !== 'bearer' ||
      !grant.access_token ||
      !String(grant.scope || '')
        .split(/\s+/)
        .includes('identify')
    )
      return redirect(back + '?login=failed', [clearFlow]);
    const identity = await fetcher(IDENTITY, {
      redirect: 'manual',
      signal: AbortSignal.timeout(9000),
      headers: { Authorization: 'Bearer ' + grant.access_token, Accept: 'application/json' }
    });
    if (!identity.ok) return redirect(back + '?login=failed', [clearFlow]);
    const profile = await identity.json();
    if (!/^\d{15,22}$/.test(profile.id) || typeof profile.username !== 'string' || !profile.username) {
      return redirect(back + '?login=failed', [clearFlow]);
    }
    const user = {
      id: profile.id,
      username: profile.username.slice(0, 64),
      displayName: (
        (typeof profile.global_name === 'string' && profile.global_name) ||
        profile.username
      ).slice(0, 96)
    };
    const session = randomKey();
    await clear(env, 'session', cookieValue(request, SESSION));
    await create(env, 'session', session, { user, expires: Date.now() + SESSION_TTL * 1000 });
    return redirect(back, [clearFlow, cookie(SESSION, session, SESSION_TTL)]);
  } catch {
    return redirect(back + '?login=failed', [clearFlow]);
  }
}
export async function route(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!/^\/(api|auth)(\/|$)/.test(url.pathname)) return env.ASSETS.fetch(request);
  const routes = {
    '/auth/login': 'POST',
    '/auth/logout': 'POST',
    '/auth/callback': 'GET',
    '/api/session': 'GET'
  };
  const method = Object.hasOwn(routes, url.pathname) && routes[url.pathname];
  if (!method) return json({ error: 'Unknown endpoint.' }, 404);
  if (request.method !== method) return json({ error: 'Method not allowed.' }, 405, { Allow: method });
  const enabled = configured(env, url);
  if (url.pathname === '/api/session') {
    if (!enabled) return json({ enabled: false, user: null });
    const key = cookieValue(request, SESSION);
    if (!key) return json({ enabled: true, user: null });
    const result = await vault(env, 'session', key, 'session');
    return json(
      { enabled: true, user: result.ok ? await result.json() : null },
      200,
      result.ok ? {} : { 'Set-Cookie': cookie(SESSION, '', 0) }
    );
  }
  if (!enabled) return json({ error: 'Discord sign-in is not configured for this address.' }, 503);
  if (method === 'POST' && request.headers.get('Origin') !== env.SITE_ORIGIN)
    return json({ error: 'Use the form on this site.' }, 403);
  if (url.pathname === '/auth/login') return start(request, env);
  if (url.pathname === '/auth/callback') return callback(request, url, env, fetcher);
  await clear(env, 'session', cookieValue(request, SESSION));
  await clear(env, 'flow', cookieValue(request, FLOW));
  return redirect('/?login=signedout', [cookie(SESSION, '', 0), cookie(FLOW, '', 0)]);
}
export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      return json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, 503);
    }
  }
};
