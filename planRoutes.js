const express = require('express');
const crypto = require('node:crypto');
const { putPlan, getPlan } = require('./kvStore');

const router = express.Router();
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function newId() {
  // 13-char base32-ish: 10 random bytes, base64url, lowercased, alphanumeric-only, first 13 chars
  return crypto.randomBytes(10).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 13);
}

function publicUrl(req, id) {
  const origin = req.headers.origin || 'https://sorted.neverstill.llc';
  return `${origin}/?p=${id}`;
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
  res.json({ id, url: publicUrl(req, id) });
});

router.get('/:id', async (req, res) => {
  const plan = await getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  res.json(stripPhones(plan));
});

module.exports = router;
