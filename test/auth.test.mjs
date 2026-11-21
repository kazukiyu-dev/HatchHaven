// Run against the actual Worker handlers and AuthVault class, with in-memory storage and a mock Discord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { route, AuthVault } from '../src/worker.mjs';

const origin = 'https://haven.example',
  flowName = '__Host-hh_flow',
  sessionName = '__Host-hh_session';
const sessionUser = { id: '100000000000000001', username: 'hatcher', displayName: 'Test Collector' };
const digest = (x) => createHash('sha256').update(x).digest('base64url');
class MemoryStorage {
  values = new Map();
  tail = Promise.resolve();
  get(k) {
    return this.values.get(k);
  }
  put(k, v) {
    this.values.set(k, structuredClone(v));
  }
  delete(k) {
    this.values.delete(k);
  }
  deleteAll() {
    this.values.clear();
  }
  setAlarm(time) {
    this.alarmAt = time;
  }
  deleteAlarm() {
    this.alarmAt = undefined;
  }
  transaction(fn) {
    const work = this.tail.then(() => fn(this));
    this.tail = work.catch(() => {});
    return work;
  }
}
function setup() {
  const records = new Map();
  const vault = {
    idFromName: (k) => k,
    get(key) {
      if (!records.has(key)) {
        const storage = new MemoryStorage();
        const object = new AuthVault({ storage });
        records.set(key, {
          storage,
          object,
          fetch: (url, init) => object.fetch(new Request(url, init))
        });
      }
      return records.get(key);
    }
  };
  return {
    records,
    env: {
      SITE_ORIGIN: origin,
      DISCORD_CLIENT_ID: '100000000000000009',
      DISCORD_CLIENT_SECRET: 'test-only',
      AUTH_VAULT: vault,
      AUTH_RATE: { limit: async () => ({ success: true }) },
      ASSETS: { fetch: () => new Response('asset') }
    }
  };
}
function req(path, method = 'GET', cookie = '', requestOrigin = origin) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  if (requestOrigin) headers.set('Origin', requestOrigin);
  return new Request(origin + path, { method, headers });
}
function rawCookie(r, name) {
  return r.headers.getSetCookie().find((x) => x.startsWith(name + '='));
}
function firstPart(value) {
  return value.split(';')[0];
}
async function begin(env, back = '/shop/', oldCookie = '') {
  const res = await route(
    req('/auth/login?return_to=' + encodeURIComponent(back), 'POST', oldCookie),
    env
  );
  assert.equal(res.status, 303);
  const consent = new URL(res.headers.get('Location'));
  const flow = firstPart(rawCookie(res, flowName));
  return { consent, flow, state: consent.searchParams.get('state'), res };
}
function cb(flow, state, extra = 'code=sample') {
  return req('/auth/callback?state=' + encodeURIComponent(state) + '&' + extra, 'GET', flow, null);
}
function provider(consent, options = {}) {
  return async (url, init) => {
    assert.equal(init.redirect, 'manual');
    if (url.endsWith('/oauth2/token')) {
      assert.equal(url, 'https://discord.com/api/oauth2/token');
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('client_secret'), 'test-only');
      assert.equal(init.body.get('redirect_uri'), origin + '/auth/callback');
      assert.equal(digest(init.body.get('code_verifier')), consent.searchParams.get('code_challenge'));
      if (options.rejectToken) return new Response(null, { status: 400 });
      return Response.json({
        token_type: 'Bearer',
        scope: 'identify',
        access_token: 'transient-test-access',
        refresh_token: 'transient-test-refresh'
      });
    }
    assert.equal(url, 'https://discord.com/api/v10/users/@me');
    assert.equal(init.headers.Authorization, 'Bearer transient-test-access');
    if (options.rejectUser) return new Response(null, { status: 503 });
    return Response.json({
      id: sessionUser.id,
      username: sessionUser.username,
      global_name: sessionUser.displayName,
      email: 'unused@example.invalid'
    });
  };
}
async function signedIn(fixture, oldCookie = '') {
  const tx = await begin(fixture.env, '/shop/', oldCookie);
  const response = await route(
    cb(tx.flow + (oldCookie ? '; ' + oldCookie : ''), tx.state),
    fixture.env,
    provider(tx.consent)
  );
  assert.equal(response.headers.get('Location'), '/shop/');
  return { tx, response, session: firstPart(rawCookie(response, sessionName)) };
}

test('public assets work independently and account status reports missing setup', async () => {
  const { env } = setup();
  assert.equal(await (await route(req('/about/'), env)).text(), 'asset');
  for (const missing of [
    'SITE_ORIGIN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'AUTH_VAULT',
    'AUTH_RATE'
  ]) {
    const settings = { ...env, [missing]: undefined };
    assert.deepEqual(await (await route(req('/api/session'), settings)).json(), {
      enabled: false,
      user: null
    });
    assert.equal((await route(req('/auth/login', 'POST'), settings)).status, 503);
  }
  assert.deepEqual(
    await (await route(new Request('https://elsewhere.example/api/session'), env)).json(),
    { enabled: false, user: null }
  );
});
test('sign-in uses identify and S256 with private single-use browser cookies', async () => {
  const { env, records } = setup();
  const t = await begin(env);
  assert.equal(t.consent.origin, 'https://discord.com');
  assert.equal(t.consent.pathname, '/oauth2/authorize');
  assert.equal(t.consent.searchParams.get('scope'), 'identify');
  assert.equal(t.consent.searchParams.get('response_type'), 'code');
  assert.equal(t.consent.searchParams.get('code_challenge_method'), 'S256');
  assert.match(t.state, /^[\w-]{43}$/);
  assert.equal(t.consent.searchParams.get('redirect_uri'), origin + '/auth/callback');
  assert.ok(!t.consent.searchParams.has('client_secret'));
  assert.match(rawCookie(t.res, flowName), /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
  assert.notEqual(t.state, t.flow.split('=')[1]);
  assert.equal(records.size, 1);
});
test('callback yields only the three identity fields and an eight-hour opaque session', async () => {
  const f = setup();
  const { response, session } = await signedIn(f);
  assert.match(
    rawCookie(response, sessionName),
    /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800/
  );
  assert.match(rawCookie(response, flowName), /Max-Age=0/);
  const result = await route(req('/api/session', 'GET', session), f.env);
  assert.deepEqual(await result.json(), { enabled: true, user: sessionUser });
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const stored = [...f.records.values()].flatMap((x) => [...x.storage.values.values()]);
  assert.equal(stored.length, 1);
  assert.doesNotMatch(JSON.stringify(stored), /transient-test|unused@example|test-only/);
});
test('expired, mismatched, missing and ambiguous state cannot complete a login', async () => {
  const f = setup();
  const t = await begin(f.env);
  for (const r of [
    cb('', t.state),
    cb(t.flow, 'x'.repeat(43)),
    cb(t.flow, t.state, 'state=' + t.state + '&code=sample'),
    cb(t.flow, t.state, 'iss=https%3A%2F%2Fother.example&code=sample')
  ]) {
    const res = await route(r, f.env, () => assert.fail('unexpected provider request'));
    assert.match(res.headers.get('location'), /login=expired/);
    assert.equal(rawCookie(res, sessionName), undefined);
  }
  const value = [...f.records.values()][0].storage.get('record');
  value.expires = Date.now() - 1;
  assert.match((await route(cb(t.flow, t.state), f.env)).headers.get('location'), /expired/);
});
test('simultaneous callbacks can exchange the authorization code only once', async () => {
  const f = setup();
  const t = await begin(f.env);
  const mock = provider(t.consent);
  let tokenCalls = 0;
  const fetcher = (u, i) => {
    if (u.endsWith('/token')) tokenCalls++;
    return mock(u, i);
  };
  const r = await Promise.all([
    route(cb(t.flow, t.state), f.env, fetcher),
    route(cb(t.flow, t.state), f.env, fetcher)
  ]);
  assert.equal(tokenCalls, 1);
  assert.deepEqual(r.map((x) => x.headers.get('Location')).sort(), ['/?login=expired', '/shop/']);
});
test('denials and upstream failures finish with safe, retryable messages', async () => {
  for (const mode of ['denied', 'rejectToken', 'rejectUser', 'offline']) {
    const f = setup(),
      t = await begin(f.env);
    const fetcher =
      mode === 'offline'
        ? () => {
            throw Error('timeout');
          }
        : provider(t.consent, { [mode]: true });
    const r = await route(
      cb(t.flow, t.state, mode === 'denied' ? 'error=access_denied' : 'code=sample'),
      f.env,
      fetcher
    );
    assert.equal(
      r.headers.get('Location'),
      '/shop/?login=' + (mode === 'denied' ? 'cancelled' : 'failed')
    );
    assert.equal(rawCookie(r, sessionName), undefined);
    assert.match(rawCookie(r, flowName), /Max-Age=0/);
  }
});
test('login and logout accept same-origin POST and only local page returns', async () => {
  const f = setup();
  for (const name of ['login', 'logout']) {
    assert.equal((await route(req('/auth/' + name), f.env)).status, 405);
    assert.equal(
      (await route(req('/auth/' + name, 'POST', '', 'https://other.example'), f.env)).status,
      403
    );
    assert.equal((await route(req('/auth/' + name, 'POST', '', null), f.env)).status, 403);
  }
  const t = await begin(f.env, 'https://other.example/');
  assert.equal(
    (await route(cb(t.flow, t.state), f.env, provider(t.consent))).headers.get('Location'),
    '/'
  );
});
test('starting another login replaces the previous attempt in this browser', async () => {
  const f = setup();
  const t1 = await begin(f.env);
  const t2 = await begin(f.env, '/', t1.flow);
  assert.notEqual(t1.flow, t2.flow);
  assert.match((await route(cb(t1.flow, t1.state), f.env)).headers.get('Location'), /expired/);
});
test('rate limited login creates no flow record or provider request', async () => {
  const f = setup();
  f.env.AUTH_RATE.limit = async () => ({ success: false });
  const r = await route(req('/auth/login', 'POST'), f.env);
  assert.equal(r.headers.get('Location'), '/?login=busy');
  assert.equal(f.records.size, 0);
});
test('signing out immediately removes the session, including a previously issued cookie', async () => {
  const f = setup();
  const { session } = await signedIn(f);
  const end = await route(req('/auth/logout', 'POST', session), f.env);
  assert.match(rawCookie(end, sessionName), /Max-Age=0/);
  assert.deepEqual(await (await route(req('/api/session', 'GET', session), f.env)).json(), {
    enabled: true,
    user: null
  });
});
test('expired sessions are rejected before alarm cleanup and the alarm removes their record', async () => {
  const f = setup();
  const { session } = await signedIn(f);
  const saved = [...f.records.values()].find((s) => s.storage.get('record')?.kind === 'session');
  assert.ok(saved.storage.alarmAt > Date.now());
  saved.storage.get('record').expires = Date.now() - 1;
  assert.equal((await (await route(req('/api/session', 'GET', session), f.env)).json()).user, null);
  await saved.object.alarm();
  assert.equal(saved.storage.values.size, 0);
});
test('a fresh login rotates and invalidates the old web session', async () => {
  const f = setup();
  const old = await signedIn(f);
  const fresh = await signedIn(f, old.session);
  assert.notEqual(fresh.session, old.session);
  assert.equal((await (await route(req('/api/session', 'GET', old.session), f.env)).json()).user, null);
});
test('private endpoints fail closed on an unavailable binding', async () => {
  const f = setup();
  f.env.AUTH_RATE.limit = () => {
    throw Error('temporary outage');
  };
  const r = await worker.fetch(req('/auth/login', 'POST'), f.env);
  assert.equal(r.status, 503);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(rawCookie(r, sessionName), undefined);
});
