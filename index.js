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

async function logForgeLead({ email, idea, productName, spec }) {
  const notionKey = process.env.NOTION_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const FORGE_LEADS_DB = 'a6d465a6-704a-4ecd-8df3-7791fca9cf70';

  // Log to Notion Forge Leads database
  if (notionKey) {
    try {
      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: FORGE_LEADS_DB },
          properties: {
            'Name': { title: [{ text: { content: email } }] },
            'Email': { email: email },
            'Idea': { rich_text: [{ text: { content: idea } }] },
            'Product Name': { rich_text: [{ text: { content: productName } }] },
            'Status': { select: { name: 'New' } }
          }
        })
      });
    } catch(e) {
      console.error('Notion log failed:', e.message);
    }
  }

  // Send rich email notification
  if (resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Forge <forge@getrebuilt.app>',
          to: 'everett@neverstill.llc',
          subject: `Forge Lead: ${productName} — ${email}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
              <h2 style="margin:0 0 8px">New Forge Lead</h2>
              <p style="color:#666;margin:0 0 24px">Someone just built something with Forge.</p>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold;width:140px">Email</td><td style="padding:12px;border:1px solid #eee">${email}</td></tr>
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold">Their idea</td><td style="padding:12px;border:1px solid #eee">${idea}</td></tr>
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold">Product name</td><td style="padding:12px;border:1px solid #eee">${productName}</td></tr>
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold">Category</td><td style="padding:12px;border:1px solid #eee">${spec.category}</td></tr>
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold">Target user</td><td style="padding:12px;border:1px solid #eee">${spec.targetUser}</td></tr>
                <tr><td style="padding:12px;border:1px solid #eee;font-weight:bold">Core pain</td><td style="padding:12px;border:1px solid #eee">${spec.corePain}</td></tr>
              </table>
              <div style="margin:24px 0">
                <a href="mailto:${email}?subject=Let's build ${productName}&body=Hey, I saw you used Forge to build ${productName}. I'd love to talk about turning this into the real thing." style="background:#0d0d0c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reply to ${email}</a>
              </div>
              <p style="color:#999;font-size:12px">View in Notion: <a href="https://notion.so/">Forge Leads database</a></p>
            </div>
          `
        })
      });
    } catch(e) {
      console.error('Email notification failed:', e.message);
    }
  }
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

  try {
  // Pass 1: Classify the product and define design spec
  const classifyPrompt = `You are a product designer. Analyze this product idea and return a JSON design specification.

Idea: "${idea.trim()}"

Return ONLY valid JSON with these fields:
{
  "productName": "a specific, memorable product name for this idea",
  "category": one of: "b2b-saas" | "consumer-app" | "developer-tool" | "finance" | "health" | "marketplace" | "ecommerce",
  "tagline": "one sharp sentence, max 10 words",
  "targetUser": "specific person this is built for, e.g. 'independent coffee shop owners'",
  "corePain": "the specific problem being solved, one sentence",
  "features": ["feature 1", "feature 2", "feature 3"],
  "designSystem": {
    "primaryColor": "a hex color appropriate for this category",
    "secondaryColor": "complementary hex color",
    "bgColor": "background hex color",
    "textColor": "primary text hex color",
    "fontHeading": "a specific Google Fonts heading font appropriate for the category",
    "fontBody": "a specific Google Fonts body font",
    "aesthetic": "2-3 word description of the visual direction"
  },
  "appScreens": [
    {"name": "screen name", "description": "what this screen shows"},
    {"name": "screen name", "description": "what this screen shows"}
  ]
}`;

  const classifyResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: classifyPrompt }] })
  });
  const classifyData = await classifyResponse.json();
  if (!classifyResponse.ok) return res.status(classifyResponse.status).json({ error: classifyData.error?.message || 'Classification failed' });

  let spec;
  try {
    spec = JSON.parse(classifyData.content[0].text.replace(/```json|```/g, '').trim());
  } catch(e) {
    return res.status(500).json({ error: 'Failed to parse design spec' });
  }

  // Pass 2: Generate the full landing page using the spec
  const generatePrompt = `You are an expert product designer. Generate a complete, production-quality HTML landing page.

Product specification:
- Name: ${spec.productName}
- Category: ${spec.category}
- Tagline: ${spec.tagline}
- Target user: ${spec.targetUser}
- Core pain solved: ${spec.corePain}
- Key features: ${spec.features.join(', ')}
- Aesthetic: ${spec.designSystem.aesthetic}
- Primary color: ${spec.designSystem.primaryColor}
- Secondary color: ${spec.designSystem.secondaryColor}
- Background: ${spec.designSystem.bgColor}
- Text: ${spec.designSystem.textColor}
- Heading font: ${spec.designSystem.fontHeading} (Google Fonts)
- Body font: ${spec.designSystem.fontBody} (Google Fonts)
- App screens to show: ${spec.appScreens.map(s => s.name + ': ' + s.description).join(' | ')}

REQUIRED SECTIONS IN ORDER:

1. NAV BAR — logo (${spec.productName}), 2-3 nav links, CTA button

2. HERO — bold specific headline targeting ${spec.targetUser}, subheadline, primary + secondary CTAs.
   Below the CTAs: a LARGE product showcase.
   Layout: one desktop browser frame in the center showing the main app dashboard, flanked by two mobile phone frames showing the app screens described above.
   ALL FRAMES ARE PURE HTML/CSS — no images, no SVG files, no canvas, no external assets.
   Desktop frame: browser chrome (traffic lights, address bar), realistic app UI inside using the design colors, fake data specific to ${spec.productName}.
   Mobile frames: phone with notch/status bar, different app screens with realistic UI, same color system.
   Frames should have subtle shadows, feel polished, match the design system exactly.

3. SOCIAL PROOF — stat strip or logos (3-4 fake but plausible companies or stats specific to ${spec.targetUser} context)

4. FEATURES — heading, 3 feature cards with CSS icon, title, 2-sentence description. All specific to ${spec.productName}.

5. HOW IT WORKS — 3 numbered steps specific to the workflow

6. TESTIMONIALS — 2-3 quotes with realistic name/title/company, specific to the value prop

7. PRICING — 2-3 tiers, highlight middle tier, features specific to ${spec.productName}

8. FINAL CTA — strong closing headline, button

9. FOOTER — logo, tagline, links, copyright

DESIGN RULES:
- Complete self-contained HTML, all CSS in <style> tag
- Only external dependency: Google Fonts (${spec.designSystem.fontHeading} + ${spec.designSystem.fontBody})
- Use the exact colors from the spec above throughout
- Mobile responsive
- All copy is specific to ${spec.productName} and ${spec.targetUser} — zero generic filler
- Product showcase frames are the hero visual — invest most effort here

Return ONLY the complete HTML. No explanation. Start with <!DOCTYPE html>, end with </html>.`;

  const generateResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 7000, messages: [{ role: 'user', content: generatePrompt }] })
  });
  const generateData = await generateResponse.json();
  if (!generateResponse.ok) return res.status(generateResponse.status).json({ error: generateData.error?.message || 'Generation failed' });

  const html = generateData.content[0].text.trim();

  // Log lead to Notion and send email notification (non-blocking)
  logForgeLead({ email, idea: idea.trim(), productName: spec.productName, spec }).catch(e => console.error('Lead logging failed:', e));

  res.json({ html, productName: spec.productName, tagline: spec.tagline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`sorted-api on port ${PORT}`));
