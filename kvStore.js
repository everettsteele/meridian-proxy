const ACCOUNT = () => process.env.CLOUDFLARE_ACCOUNT_ID;
const NAMESPACE = () => process.env.CLOUDFLARE_KV_NAMESPACE_ID;
const TOKEN = () => process.env.CLOUDFLARE_API_TOKEN;

function base(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT()}/storage/kv/namespaces/${NAMESPACE()}/values/${encodeURIComponent(key)}`;
}

async function putPlan(id, plan, ttlSeconds) {
  const res = await fetch(`${base(id)}?expiration_ttl=${ttlSeconds}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(plan)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV put failed (${res.status}): ${body}`);
  }
}

async function getPlan(id) {
  const res = await fetch(base(id), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${TOKEN()}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV get failed (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { putPlan, getPlan };
