const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
process.env.CLOUDFLARE_KV_NAMESPACE_ID = 'ns-456';
process.env.CLOUDFLARE_API_TOKEN = 'token-789';

const { putPlan, getPlan } = require('../kvStore');

function stubFetch(responder) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return responder({ url, opts });
  };
  return calls;
}

test('putPlan calls Cloudflare KV REST with correct URL, method, auth, body, and TTL', async () => {
  const calls = stubFetch(() => new Response('{"success":true}', { status: 200 }));
  const plan = { id: 'abc', crewName: 'Crew' };

  await putPlan('abc', plan, 3600);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/storage/kv/namespaces/ns-456/values/abc?expiration_ttl=3600');
  assert.equal(calls[0].opts.method, 'PUT');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer token-789');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].opts.body, JSON.stringify(plan));
});

test('putPlan throws on non-2xx', async () => {
  stubFetch(() => new Response('{"success":false,"errors":[{"message":"nope"}]}', { status: 500 }));
  await assert.rejects(() => putPlan('abc', { id: 'abc' }, 3600), /KV put failed/);
});

test('getPlan returns parsed JSON on 200', async () => {
  stubFetch(() => new Response(JSON.stringify({ id: 'abc', crewName: 'Crew' }), { status: 200 }));
  const plan = await getPlan('abc');
  assert.deepEqual(plan, { id: 'abc', crewName: 'Crew' });
});

test('getPlan returns null on 404', async () => {
  stubFetch(() => new Response('{"success":false}', { status: 404 }));
  const plan = await getPlan('abc');
  assert.equal(plan, null);
});

test('getPlan throws on other non-2xx', async () => {
  stubFetch(() => new Response('{"success":false}', { status: 500 }));
  await assert.rejects(() => getPlan('abc'), /KV get failed/);
});
