function buildPlanPrompt(plan, lockedDate) {
  const names = plan.crew.map(p => p.name).join(', ');
  return `Build per-person logistics for a crew day out.

Activity: ${plan.activity.name}
Pitch: ${plan.activity.blurb || ''}
City: ${plan.city}
Date: ${lockedDate}
Crew: ${names}
Drive-distance preference (1-5, 5 = longer): ${plan.driveDistance}
Vibe — adventure ${plan.vibe.adventure}/5, risk ${plan.vibe.risk}/5, cost ${plan.vibe.cost}/5

For each person, return:
- name
- driveTime (rough estimate, e.g. "25 min")
- bring (what to bring, ~1 short line)
- notes (weather, timing, anything practical, ~1–2 lines)

Return ONLY a JSON array (no prose, no fences) of objects with keys: name, driveTime, bring, notes.`;
}

function parsePlanResponse(rawText) {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  let obj;
  try { obj = JSON.parse(cleaned); }
  catch { throw new Error('planBuilder: invalid JSON'); }
  if (!Array.isArray(obj)) throw new Error('planBuilder: expected array');
  return obj;
}

module.exports = { buildPlanPrompt, parsePlanResponse };
