const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConsensusPrompt, parseConsensusResponse } = require('../consensus');

test('buildConsensusPrompt includes today, crew names, and every availability string', () => {
  const plan = {
    crewName: 'ABC Dads',
    votes: [
      { name: 'Mark', availability: 'any Saturday after 1pm', at: 0 },
      { name: 'Dave', availability: 'not 4/25, otherwise weekends work', at: 0 }
    ],
    activity: { name: 'Skeet shooting' },
    city: 'Atlanta'
  };
  const prompt = buildConsensusPrompt(plan, '2026-04-12');

  assert.match(prompt, /2026-04-12/);
  assert.match(prompt, /Mark: any Saturday after 1pm/);
  assert.match(prompt, /Dave: not 4\/25, otherwise weekends work/);
  assert.match(prompt, /Skeet shooting/);
  assert.match(prompt, /Atlanta/);
  assert.match(prompt, /"date"/);
  assert.match(prompt, /"reasoning"/);
});

test('parseConsensusResponse parses clean JSON', () => {
  const raw = '{"date":"2026-04-18","reasoning":"Only Saturday everyone can make."}';
  assert.deepEqual(parseConsensusResponse(raw), { date: '2026-04-18', reasoning: 'Only Saturday everyone can make.' });
});

test('parseConsensusResponse strips ```json fences', () => {
  const raw = '```json\n{"date":"2026-04-18","reasoning":"Good."}\n```';
  assert.deepEqual(parseConsensusResponse(raw), { date: '2026-04-18', reasoning: 'Good.' });
});

test('parseConsensusResponse throws on invalid JSON', () => {
  assert.throws(() => parseConsensusResponse('not json'), /consensus: invalid JSON/);
});

test('parseConsensusResponse throws on wrong date shape', () => {
  assert.throws(() => parseConsensusResponse('{"date":"next Saturday","reasoning":"x"}'), /consensus: bad date format/);
});

test('parseConsensusResponse throws on missing reasoning', () => {
  assert.throws(() => parseConsensusResponse('{"date":"2026-04-18"}'), /consensus: missing reasoning/);
});
