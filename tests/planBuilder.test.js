const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlanPrompt, parsePlanResponse } = require('../planBuilder');

const plan = {
  crewName: 'ABC Dads',
  crew: [{ name: 'Mark' }, { name: 'Dave' }],
  city: 'Atlanta',
  driveDistance: 2,
  vibe: { adventure: 3, risk: 2, cost: 2 },
  activity: { name: 'Skeet shooting', blurb: 'Shoot clays at Big Red Oak.' }
};

test('buildPlanPrompt bakes in the locked date, crew names, activity, and city', () => {
  const prompt = buildPlanPrompt(plan, '2026-04-18');
  assert.match(prompt, /2026-04-18/);
  assert.match(prompt, /Mark/);
  assert.match(prompt, /Dave/);
  assert.match(prompt, /Skeet shooting/);
  assert.match(prompt, /Atlanta/);
});

test('parsePlanResponse parses an array of per-person plans', () => {
  const raw = '[{"name":"Mark","driveTime":"20 min","bring":"eye pro","notes":"meet at 1pm"},{"name":"Dave","driveTime":"35 min","bring":"cash","notes":"drive north"}]';
  const parsed = parsePlanResponse(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Mark');
  assert.equal(parsed[1].driveTime, '35 min');
});

test('parsePlanResponse strips code fences', () => {
  const raw = '```json\n[{"name":"Mark"}]\n```';
  assert.deepEqual(parsePlanResponse(raw), [{ name: 'Mark' }]);
});

test('parsePlanResponse throws on non-array result', () => {
  assert.throws(() => parsePlanResponse('{"name":"Mark"}'), /planBuilder: expected array/);
});

test('parsePlanResponse throws on invalid JSON', () => {
  assert.throws(() => parsePlanResponse('nope'), /planBuilder: invalid JSON/);
});
