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
  return crypto.randomBytes(10).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 13);
}

function newToken() {
  return crypto.randomBytes(16).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 22);
}

function publicUrl(id) {
  return `${PUBLIC_BASE_URL}/?p=${id}`;
}

function organizerUrl(id, token) {
  return `${PUBLIC_BASE_URL}/?p=${id}&t=${token}`;
}

function publicView(plan, isOrganizer) {
  // Strip phones + the organizer token from every public response.
  const { organizerToken, ...rest } = plan;
  return { ...rest, crew: plan.crew.map(({ name }) => ({ name })), isOrganizer: !!isOrganizer };
}

async function refineKnownPlan(rawText, crewSize) {
  const prompt = `The organizer of a guys' day out wrote this rough plan: "${rawText}"

Crew size: ${crewSize}

Turn it into a concrete plan. Pick a specific, real venue (use the location they hinted at if any). Give reasonable timing, cost, and gear guidance. Fill in missing pieces with sensible defaults.

Return ONLY a JSON object (no prose, no fences) with these keys:
{
  "name": "short punchy activity + venue, e.g. 'Skeet at Big Red Oak Sporting Clays'",
  "venueType": "category like 'sporting clays range'",
  "description": "2-3 sentences about what they'll actually do, what's cool about this venue",
  "city": "the city/area this happens in",
  "meetTime": "e.g. '1:00 PM'",
  "duration": "e.g. '2-3 hours'",
  "estimatedCost": "e.g. '$60-80/person'",
  "whatToBring": ["item", "item", "item"],
  "parkingNotes": "one short logistics note"
}`;
  const raw = await callClaude(prompt, 600);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  let obj;
  try { obj = JSON.parse(cleaned); }
  catch { throw new Error('refine: invalid JSON'); }
  if (!obj.name) throw new Error('refine: missing name');
  return obj;
}

router.post('/', async (req, res) => {
  const { crewName, crew, city, driveDistance, vibe, activity, organizerAvailability, knownPlan } = req.body || {};
  if (!Array.isArray(crew) || crew.length === 0) return res.status(400).json({ error: 'crew required' });
  for (const p of crew) {
    if (!p.name || !p.name.trim()) return res.status(400).json({ error: 'every crew row needs a name' });
  }
  if (!activity || !activity.name) return res.status(400).json({ error: 'activity required' });
  if (!organizerAvailability || !organizerAvailability.trim()) return res.status(400).json({ error: 'organizerAvailability required' });
  if (!knownPlan && (!city || !vibe)) return res.status(400).json({ error: 'city and vibe required for discovery flow' });

  let finalActivity = activity;
  let finalCity = city || '';
  const originalPlanText = knownPlan ? activity.name : '';

  if (knownPlan) {
    try {
      const refined = await refineKnownPlan(activity.name, crew.length);
      finalActivity = {
        name: refined.name,
        venueType: refined.venueType || '',
        description: refined.description || '',
        blurb: refined.description || '',
        whatToBring: refined.whatToBring || [],
        meetTime: refined.meetTime || '',
        duration: refined.duration || '',
        estimatedCost: refined.estimatedCost || '',
        parkingNotes: refined.parkingNotes || ''
      };
      finalCity = refined.city || '';
    } catch (err) {
      console.error('[planRoutes] refine failed:', err.message);
      return res.status(500).json({ error: 'could not refine plan: ' + err.message });
    }
  }

  const id = newId();
  const organizerToken = newToken();
  const now = Date.now();
  const plan = {
    id, createdAt: now, crewName: crewName || '',
    crew: crew.map(p => ({ name: p.name.trim(), phone: (p.phone || '').trim() })),
    city: finalCity, driveDistance: driveDistance || 3,
    vibe: vibe || { adventure: 3, risk: 2, cost: 2 },
    activity: finalActivity,
    knownPlan: !!knownPlan, originalPlanText,
    votes: [{ name: crew[0].name.trim(), availability: organizerAvailability.trim(), at: now }],
    locked: false, finalDate: null, finalReason: null, finalPlan: null,
    organizerToken
  };
  await putPlan(id, plan, TTL_SECONDS);
  res.json({ id, url: publicUrl(id), organizerUrl: organizerUrl(id, organizerToken), organizerToken });
});

router.get('/:id', async (req, res) => {
  const plan = await getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  const isOrganizer = !!(req.query.t && plan.organizerToken && req.query.t === plan.organizerToken);
  res.json(publicView(plan, isOrganizer));
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
  if (plan.organizerToken && req.query.t !== plan.organizerToken) {
    return res.status(403).json({ error: 'organizer token required' });
  }
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

    // Step B: plan build — runs for both flows now that known plans get a refined activity
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
