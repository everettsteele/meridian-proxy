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

test('POST /api/plan/:id/vote inserts a new voter', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }, { name: 'Dave', phone: '+2' }],
    crewName: 'x', city: 'x', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' },
    votes: [{ name: 'Mark', availability: 'any Sat', at: 1 }],
    locked: false, finalDate: null, finalReason: null, finalPlan: null
  });
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan/abc/vote', { name: 'Dave', availability: '4/18 works' });
    assert.equal(r.status, 200);
    const stored = store.get('abc');
    assert.equal(stored.votes.length, 2);
    assert.equal(stored.votes[1].name, 'Dave');
    assert.equal(stored.votes[1].availability, '4/18 works');
  } finally { server.close(); }
});

test('POST /api/plan/:id/vote updates an existing voter (upsert by name)', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }],
    crewName: 'x', city: 'x', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' },
    votes: [{ name: 'Mark', availability: 'any Sat', at: 1 }],
    locked: false, finalDate: null, finalReason: null, finalPlan: null
  });
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan/abc/vote', { name: 'Mark', availability: 'actually, Sundays work too' });
    assert.equal(r.status, 200);
    const stored = store.get('abc');
    assert.equal(stored.votes.length, 1);
    assert.equal(stored.votes[0].availability, 'actually, Sundays work too');
  } finally { server.close(); }
});

test('POST /api/plan/:id/vote rejects voter name not on crew roster', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }],
    crewName: 'x', city: 'x', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' }, votes: [], locked: false,
    finalDate: null, finalReason: null, finalPlan: null
  });
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan/abc/vote', { name: 'Stranger', availability: 'x' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not on the crew/i);
  } finally { server.close(); }
});

test('POST /api/plan/:id/vote returns 409 when plan is locked', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }],
    crewName: 'x', city: 'x', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' }, votes: [], locked: true,
    finalDate: '2026-04-18', finalReason: 'x', finalPlan: []
  });
  const { server, port } = await startApp();
  try {
    const r = await request(port, 'POST', '/api/plan/abc/vote', { name: 'Mark', availability: 'x' });
    assert.equal(r.status, 409);
  } finally { server.close(); }
});

test('POST /api/plan/:id/lock runs consensus then plan-build, writes finalDate/finalReason/finalPlan, sets locked', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }, { name: 'Dave', phone: '+2' }],
    crewName: 'x', city: 'Atlanta', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'Skeet', blurb: 'bang' },
    votes: [
      { name: 'Mark', availability: 'any Saturday after 1pm', at: 1 },
      { name: 'Dave', availability: 'not 4/25, otherwise weekends', at: 2 }
    ],
    locked: false, finalDate: null, finalReason: null, finalPlan: null
  });

  // Stub the Claude callers that planRoutes imports
  require.cache[require.resolve('../claudeClient')] = {
    exports: {
      callClaude: async (prompt) => {
        if (prompt.includes('Crew availability')) {
          return '{"date":"2026-04-18","reasoning":"Only Saturday everyone can make."}';
        }
        return '[{"name":"Mark","driveTime":"20 min","bring":"eye pro","notes":"meet 1pm"},{"name":"Dave","driveTime":"35 min","bring":"cash","notes":"drive north"}]';
      }
    }
  };

  // planRoutes is already required above; re-require is not easy with node:test. Reset the cache and re-require here.
  delete require.cache[require.resolve('../planRoutes')];
  const routes = require('../planRoutes');
  const app = express(); app.use(express.json()); app.use('/api/plan', routes);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const port = server.address().port;

  try {
    const r = await request(port, 'POST', '/api/plan/abc/lock');
    assert.equal(r.status, 200);
    const stored = store.get('abc');
    assert.equal(stored.finalDate, '2026-04-18');
    assert.match(stored.finalReason, /Saturday/);
    assert.equal(stored.finalPlan.length, 2);
    assert.equal(stored.locked, true);
  } finally { server.close(); }
});

test('POST /api/plan/:id/lock retries plan-build only if already locked but finalPlan is null', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }],
    crewName: 'x', city: 'Atlanta', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'Skeet', blurb: 'bang' },
    votes: [{ name: 'Mark', availability: 'Sat', at: 1 }],
    locked: true, finalDate: '2026-04-18', finalReason: 'already picked', finalPlan: null
  });

  let consensusCalled = false;
  require.cache[require.resolve('../claudeClient')] = {
    exports: {
      callClaude: async (prompt) => {
        if (prompt.includes('Crew availability')) { consensusCalled = true; return '{"date":"X","reasoning":"x"}'; }
        return '[{"name":"Mark","driveTime":"10 min","bring":"x","notes":"x"}]';
      }
    }
  };

  delete require.cache[require.resolve('../planRoutes')];
  const routes = require('../planRoutes');
  const app = express(); app.use(express.json()); app.use('/api/plan', routes);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const port = server.address().port;

  try {
    const r = await request(port, 'POST', '/api/plan/abc/lock');
    assert.equal(r.status, 200);
    assert.equal(consensusCalled, false);
    const stored = store.get('abc');
    assert.equal(stored.finalDate, '2026-04-18'); // unchanged
    assert.equal(stored.finalPlan.length, 1);     // filled in
  } finally { server.close(); }
});

test('POST /api/plan/:id/lock returns 409 when fully locked (finalPlan present)', async () => {
  store.clear();
  store.set('abc', {
    id: 'abc', crew: [{ name: 'Mark', phone: '+1' }],
    crewName: 'x', city: 'x', driveDistance: 2, vibe: { adventure: 3, risk: 2, cost: 2 },
    activity: { name: 'x' }, votes: [{ name: 'Mark', availability: 'x', at: 1 }],
    locked: true, finalDate: '2026-04-18', finalReason: 'x', finalPlan: [{ name: 'Mark' }]
  });

  delete require.cache[require.resolve('../planRoutes')];
  const routes = require('../planRoutes');
  const app = express(); app.use(express.json()); app.use('/api/plan', routes);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const port = server.address().port;

  try {
    const r = await request(port, 'POST', '/api/plan/abc/lock');
    assert.equal(r.status, 409);
  } finally { server.close(); }
});
