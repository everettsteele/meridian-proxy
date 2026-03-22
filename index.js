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
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkChatRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit reached. Try again later.' });
  }
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

// IP rate limiting for chat endpoint — 20 requests per IP per hour
const chatRateLimit = new Map();
function checkChatRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 20;
  const record = chatRateLimit.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  if (record.count >= max) return false;
  record.count++;
  chatRateLimit.set(ip, record);
  return true;
}

// Clean up stale rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of forgeRateLimit.entries()) {
    if (now > record.resetAt) forgeRateLimit.delete(ip);
  }
  for (const [ip, record] of chatRateLimit.entries()) {
    if (now > record.resetAt) chatRateLimit.delete(ip);
  }
}, 60 * 60 * 1000);

// Verify Cloudflare Turnstile token
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: false, error: 'Turnstile not configured' };
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip })
  });
  return res.json();
}

app.post('/api/forge/gate', async (req, res) => {
  const { email, turnstileToken } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }
  if (!turnstileToken) {
    return res.status(400).json({ error: 'CAPTCHA token required.' });
  }

  // Verify CAPTCHA
  const turnstileResult = await verifyTurnstile(turnstileToken, ip);
  console.log('Turnstile result:', JSON.stringify(turnstileResult));
  if (!turnstileResult.success) {
    const reason = turnstileResult.error || turnstileResult['error-codes']?.join(', ') || 'unknown';
    return res.status(403).json({ error: `CAPTCHA verification failed: ${reason}` });
  }

  // Log email via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Forge Demo <forge@getrebuilt.app>',
          to: 'everett@neverstill.llc',
          subject: `Forge Demo: New visitor — ${email}`,
          html: `<p>New Forge demo visitor:</p><p><strong>${email}</strong></p><p>IP: ${ip}</p><p>Time: ${new Date().toISOString()}</p>`
        })
      });
    } catch (e) {
      // Log failure but don't block the user
      console.error('Resend error:', e.message);
    }
  }

  res.json({ success: true });
});

app.post('/api/forge', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkForgeRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit reached. You can generate 3 previews per hour.' });
  }

  const { idea, email } = req.body;
  if (!idea || typeof idea !== 'string' || idea.trim().length < 3) {
    return res.status(400).json({ error: 'Provide an idea (at least 3 characters).' });
  }

  const prompt = `You are an expert product designer and copywriter. Generate a complete, stunning, production-quality HTML landing page for the following product idea:

"${idea.trim()}"

The page must feel like a real funded startup's marketing site — specific copy, strong visual hierarchy, and genuine product thinking. Not generic. Not placeholder.

REQUIRED SECTIONS IN ORDER:

1. NAV BAR
   - Logo (product name) on left
   - 2-3 nav links on right
   - CTA button (e.g. "Get Early Access" or "Try Free")

2. HERO SECTION
   - Bold, specific headline (not generic — make it about the core pain point)
   - Subheadline expanding on the value prop (2 sentences max)
   - Primary CTA button + secondary link
   - Below the hero text: a LARGE product showcase section showing the app
     This showcase must be built entirely in HTML/CSS — no images, no SVG files, no canvas, no JS for rendering.
     Layout: one large desktop/tablet browser frame mockup in the center, with 2 mobile phone frames flanking it on each side (or arranged tastefully around it).
     DESKTOP FRAME: a browser chrome (address bar, tab, traffic lights) containing a realistic app interface for this product. Use colored blocks, nav bars, sidebars, data rows, charts (CSS only), cards, and realistic fake content specific to the product idea.
     MOBILE FRAMES (2): phone frames with notch/status bar showing different screens of the app — e.g. a dashboard view and a detail/action view. Make the UI feel like the real app, using colors and layout specific to the product.
     Use the brand colors from the landing page design for the app UI internals.
     All frames should have subtle shadows and look polished.

3. SOCIAL PROOF BAR
   - 3-4 company logos (fake but plausible, CSS text-based) or a stat strip (e.g. "10,000+ teams", "99.9% uptime", "$2.4M saved")

4. FEATURES SECTION
   - Strong section heading
   - 3 feature cards with icon (CSS shape or unicode), title, and 2-sentence description
   - Make features specific to the product idea — no generic "save time" filler

5. HOW IT WORKS
   - 3 numbered steps, each with a short title and description
   - Specific to the product workflow

6. TESTIMONIALS
   - 2-3 testimonials with fake but realistic name, title, company
   - Specific to the product's value prop

7. PRICING (optional but encouraged if relevant)
   - 2-3 tiers with names, prices, and 3-4 bullet features each
   - Highlight the middle/popular tier

8. FINAL CTA SECTION
   - Strong closing headline
   - CTA button

9. FOOTER
   - Logo, tagline, 3-4 nav links, copyright

DESIGN REQUIREMENTS:
- Complete self-contained HTML file, all CSS in a <style> tag
- No external dependencies except Google Fonts (one pairing allowed)
- Choose a strong, specific aesthetic direction based on the product category:
  * B2B SaaS: clean, professional, lots of white space, blue/slate tones
  * Consumer app: bold, colorful, playful, big typography
  * Finance/legal: authoritative, dark navy or deep green, serif accents
  * Health/wellness: warm, organic, soft gradients
  * Developer tool: dark mode, monospace accents, technical feel
  * Never use generic bootstrap blue or default purple gradient
- Mobile responsive
- Real, specific copy throughout — use the product idea to generate believable product names, feature names, user personas, and value props
- The app mockup frames are the hero visual — invest the most effort here
- All mockup frames must use ONLY CSS and HTML (no SVG images, no external assets, no canvas, no JS for rendering)

Return ONLY the complete HTML. No explanation, no markdown fences. Start with <!DOCTYPE html> and end with </html>.`;

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
        max_tokens: 6000,
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
