const express = require('express');
const crypto = require('node:crypto');
const { putPlan, getPlan } = require('./kvStore');
const { callClaude } = require('./claudeClient');
const { buildConsensusPrompt, parseConsensusResponse } = require('./consensus');
const { buildPlanPrompt, parsePlanResponse } = require('./planBuilder');

const router = express.Router();
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://sorted.neverstill.llc';

function newId() {
  // 13-char base32-ish: 10 random bytes, base64url, lowercased, alphanumeric-only, first 13 chars
  return crypto.randomBytes(10).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 13);
}

function publicUrl(id) {
  return `${PUBLIC_BASE_URL}/?p=${id}`;
}

function stripPhones(plan) {
  return { ...plan, crew: plan.crew.map(({ name }) => ({ name })) };
}

router.post('/', async (req, res) => {
  const { crewName, crew, city, driveDistance, vibe, activity, organizerAvailability } = req.body || {};
  if (!Array.isArray(crew) || crew.length === 0) return res.status(400).json({ error: 'crew required' });
  for (const p of crew) {
    if (!p.name || !p.name.trim()) return res.status(400).json({ error: 'every crew row needs a name' });
    if (!p.phone || !p.phone.trim()) return res.status(400).json({ error: 'every crew row needs a phone' });
  }
  if (!city || !activity || !vibe) return res.status(400).json({ error: 'city, activity, vibe required' });
  if (!organizerAvailability || !organizerAvailability.trim()) return res.status(400).json({ error: 'organizerAvailability required' });

  const id = newId();
  const now = Date.now();
  const plan = {
    id, createdAt: now, crewName: crewName || '',
    crew: crew.map(p => ({ name: p.name.trim(), phone: p.phone.trim() })),
    city, driveDistance, vibe, activity,
    votes: [{ name: crew[0].name.trim(), availability: organizerAvailability.trim(), at: now }],
    locked: false, finalDate: null, finalReason: null, finalPlan: null
  };
  await putPlan(id, plan, TTL_SECONDS);
  res.json({ id, url: publicUrl(id) });
});

router.get('/:id', async (req, res) => {
  const plan = await getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  res.json(stripPhones(plan));
});

router.post('/:id/vote', async (req, res) => {
  const name = (req.body?.name || '').trim();
  const availability = (req.body?.availability || '').trim();
  if (!name || !availability) return res.status(400).json({ error: 'name and availability required' });

  const plan = await getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  if (plan.locked) return res.status(409).json({ error: 'plan is locked' });

  const onRoster = plan.crew.some(p => p.name === name);
  if (!onRoster) return res.status(400).json({ error: 'name is not on the crew' });

  const existing = plan.votes.findIndex(v => v.name === name);
  const record = { name, availability, at: Date.now() };
  if (existing >= 0) plan.votes[existing] = record;
  else plan.votes.push(record);

  await putPlan(plan.id, plan, TTL_SECONDS);
  res.json({ ok: true });
});

router.post('/:id/lock', async (req, res) => {
  const plan = await getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  if (plan.locked && plan.finalPlan) return res.status(409).json({ error: 'plan already locked' });

  try {
    // Step A: consensus (skip if we already have finalDate from a prior partial run)
    if (!plan.finalDate) {
      const todayISO = new Date().toISOString().slice(0, 10);
      let consensusRaw;
      try {
        consensusRaw = await callClaude(buildConsensusPrompt(plan, todayISO), 400);
      } catch (e) {
        consensusRaw = await callClaude(buildConsensusPrompt(plan, todayISO), 400); // one retry
      }
      const { date, reasoning } = parseConsensusResponse(consensusRaw);
      plan.finalDate = date;
      plan.finalReason = reasoning;
      await putPlan(plan.id, plan, TTL_SECONDS);
    }

    // Step B: plan build
    const planRaw = await callClaude(buildPlanPrompt(plan, plan.finalDate), 2000);
    plan.finalPlan = parsePlanResponse(planRaw);
    plan.locked = true;
    await putPlan(plan.id, plan, TTL_SECONDS);

    res.json({ ok: true, finalDate: plan.finalDate, finalReason: plan.finalReason, finalPlan: plan.finalPlan });
  } catch (err) {
    console.error('[planRoutes] lock failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
