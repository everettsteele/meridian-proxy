const express = require('express');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/chat', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured on server' });
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// IP rate limiting for forge endpoint — 3 requests per IP per hour
const forgeRateLimit = new Map();
function checkForgeRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const max = 3;
  const record = forgeRateLimit.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  if (record.count >= max) return false;
  record.count++;
  forgeRateLimit.set(ip, record);
  return true;
}

// Clean up stale rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of forgeRateLimit.entries()) {
    if (now > record.resetAt) forgeRateLimit.delete(ip);
  }
}, 60 * 60 * 1000);

app.post('/api/forge', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkForgeRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit reached. You can generate 3 previews per hour.' });
  }

  const { idea } = req.body;
  if (!idea || typeof idea !== 'string' || idea.trim().length < 3) {
    return res.status(400).json({ error: 'Provide an idea (at least 3 characters).' });
  }

  const prompt = `You are an expert landing page designer and copywriter. Generate a complete, beautiful, production-quality HTML landing page for the following idea:

"${idea.trim()}"

Requirements:
- Complete self-contained HTML file with all CSS inline in a <style> tag
- No external dependencies except Google Fonts (allowed)
- Hero section with a strong headline and subheadline
- Features or benefits section (3 items)
- Social proof or credibility element (testimonial, stat, or trust badge)
- Clear call-to-action section
- Footer
- Mobile-responsive
- Visually striking design — choose a strong aesthetic direction (not generic bootstrap blue)
- Real-feeling copy — specific, not placeholder text
- No JavaScript required for the layout

Return ONLY the complete HTML. No explanation, no markdown fences, no commentary. Start with <!DOCTYPE html> and end with </html>.`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'API error' });
    const html = data.content[0].text.trim();
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`sorted-api on port ${PORT}`));
