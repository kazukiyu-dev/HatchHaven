// Smoke-test the shipped Worker in workerd with SQLite-backed Durable Objects and simulated Discord.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const origin = 'https://haven.example';
let challenge,
  tokenCalls = 0,
  userCalls = 0;
const moduleRoot = fileURLToPath(new URL('../src/', import.meta.url));
const modules = await Promise.all(
  ['worker.mjs', 'vault.mjs'].map(async (name) => ({
    type: 'ESModule',
    path: moduleRoot + name,
    contents: await readFile(moduleRoot + name, 'utf8')
  }))
);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules,
    modulesRoot: moduleRoot,
    compatibilityDate: '2026-02-10',
    bindings: {
      SITE_ORIGIN: origin,
      DISCORD_CLIENT_ID: '100000000000000001',
      DISCORD_CLIENT_SECRET: 'mock-client'
    },
    durableObjects: { AUTH_VAULT: { className: 'AuthVault', useSQLite: true } },
    ratelimits: { AUTH_RATE: { namespace_id: '846172', simple: { limit: 20, period: 60 } } },
    name: 'hatchhaven',
    assets: {
      directory: fileURLToPath(new URL('../public/', import.meta.url)),
      binding: 'ASSETS',
      routerConfig: { has_user_worker: true },
      run_worker_first: ['/api/*', '/auth/*'],
      assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: '404-page' }
    },
    outboundService: async (req) => {
      const endpoint = new URL(req.url);
      assert.equal(endpoint.origin, 'https://discord.com');
      if (endpoint.pathname === '/api/oauth2/token') {
        tokenCalls++;
        const body = await req.formData();
        assert.equal(
          createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
          challenge
        );
        assert.equal(body.get('client_secret'), 'mock-client');
        return Response.json({ token_type: 'Bearer', scope: 'identify', access_token: 'mock-access' });
      }
      if (endpoint.pathname === '/api/v10/users/@me') {
        userCalls++;
        assert.equal(req.headers.get('Authorization'), 'Bearer mock-access');
        return Response.json({
          username: 'collector',
          id: '100000000000000002',
          global_name: 'Collector'
        });
      }
      throw Error('Unexpected outbound response');
    }
  })
);
function call(path, method = 'GET', cookie) {
  return mf.dispatchFetch(origin + path, {
    method,
    redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }
  });
}
try {
  const about = await call('/about/');
  assert.equal(about.status, 200);
  assert.match(await about.text(), /Welcome to the haven/);
  assert.match(about.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal((await call('/missing-page')).status, 404);
  assert.deepEqual(await (await call('/api/session')).json(), { enabled: true, user: null });
  const login = await call('/auth/login?return_to=%2Fcommands%2F', 'POST');
  assert.equal(login.status, 303);
  const auth = new URL(login.headers.get('location'));
  challenge = auth.searchParams.get('code_challenge');
  const flow = login.headers.getSetCookie()[0].split(';')[0];
  const callback =
    '/auth/callback?code=local-test&iss=https%3A%2F%2Fdiscord.com&state=' +
    auth.searchParams.get('state');
  const exchange = await call(callback, 'GET', flow);
  assert.equal(exchange.headers.get('location'), '/commands/');
  const session = exchange.headers
    .getSetCookie()
    .find((x) => x.startsWith('__Host-hh_session='))
    .split(';')[0];
  assert.equal(
    (await (await call('/api/session', 'GET', session)).json()).user.displayName,
    'Collector'
  );
  assert.equal((await call(callback, 'GET', flow)).headers.get('location'), '/?login=expired');
  assert.equal(
    (await call('/auth/logout', 'POST', session)).headers.get('location'),
    '/?login=signedout'
  );
  assert.equal((await (await call('/api/session', 'GET', session)).json()).user, null);
  assert.equal(tokenCalls, 1);
  assert.equal(userCalls, 1);
  console.log(
    'Cloudflare runtime passed: real static assets and headers, native rate limit, SQLite state, PKCE, session, replay rejection and logout. Discord endpoints simulated.'
  );
} finally {
  await mf.dispose();
}
