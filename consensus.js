function buildConsensusPrompt(plan, todayISO) {
  const crewLines = plan.votes
    .map(v => `- ${v.name}: ${v.availability}`)
    .join('\n');
  return `Today's date is ${todayISO}. A crew is planning "${plan.activity.name}" in ${plan.city}. Pick one specific calendar date (YYYY-MM-DD) that maximizes attendance based on each person's availability. If nothing aligns perfectly, pick the best compromise and say why in one sentence.

Crew availability:
${crewLines}

Return ONLY a JSON object, no prose, no fences:
{"date":"YYYY-MM-DD","reasoning":"<one sentence>"}`;
}

function parseConsensusResponse(rawText) {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  let obj;
  try { obj = JSON.parse(cleaned); }
  catch { throw new Error('consensus: invalid JSON'); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.date || '')) throw new Error('consensus: bad date format');
  if (!obj.reasoning || typeof obj.reasoning !== 'string') throw new Error('consensus: missing reasoning');
  return { date: obj.date, reasoning: obj.reasoning };
}

module.exports = { buildConsensusPrompt, parseConsensusResponse };
