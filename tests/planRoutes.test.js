const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// In-memory KV double, injected before requiring planRoutes.
const store = new Map();
require.cache[require.resolve('../kvStore')] = {
  exports: {
    putPlan: async (id, plan) => { store.set(id, plan); },
    getPlan: async (id) => store.get(id) || null
  }
};

const planRoutes = require('../planRoutes');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/plan', planRoutes);
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function request(port, method, path, body) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

test('POST /api/plan creates a plan, seeds organizer vote, returns id + url', async () => {
  store.clear();
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan', {
      crewName: 'ABC Dads',
      crew: [{ name: 'Mark', phone: '+15551111' }, { name: 'Dave', phone: '+15552222' }],
      city: 'Atlanta',
      driveDistance: 2,
      vibe: { adventure: 3, risk: 2, cost: 2 },
      activity: { name: 'Skeet shooting', blurb: 'Bang bang.' },
      organizerAvailability: 'any Saturday after 1pm'
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.id && r.body.id.length >= 8);
    assert.ok(r.body.url.includes('?p=' + r.body.id));

    const stored = store.get(r.body.id);
    assert.equal(stored.crewName, 'ABC Dads');
    assert.equal(stored.votes.length, 1);
    assert.equal(stored.votes[0].name, 'Mark');
    assert.equal(stored.votes[0].availability, 'any Saturday after 1pm');
    assert.equal(stored.locked, false);
  } finally { server.close(); }
});

test('POST /api/plan rejects missing phone on a crew row', async () => {
  store.clear();
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan', {
      crewName: 'x',
      crew: [{ name: 'Mark', phone: '' }],
      city: 'Atlanta',
      driveDistance: 2,
      vibe: { adventure: 3, risk: 2, cost: 2 },
      activity: { name: 'x' },
      organizerAvailability: 'any time'
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /phone/i);
  } finally { server.close(); }
});

test('GET /api/plan/:id returns the plan with phone numbers stripped', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc',
    crew: [{ name: 'Mark', phone: '+15551111' }, { name: 'Dave', phone: '+15552222' }],
    crewName: 'x', votes: [], locked: false,
    city: 'Atlanta', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' }, finalDate: null, finalReason: null, finalPlan: null
  });
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'GET', '/api/plan/abc');
    assert.equal(r.status, 200);
    assert.equal(r.body.crew.length, 2);
    assert.equal(r.body.crew[0].phone, undefined);
    assert.equal(r.body.crew[0].name, 'Mark');
  } finally { server.close(); }
});

test('GET /api/plan/:id returns 404 when not found', async () => {
  store.clear();
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'GET', '/api/plan/nope');
    assert.equal(r.status, 404);
  } finally { server.close(); }
});
