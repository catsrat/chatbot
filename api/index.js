/**
 * LuminaBot Builder — Central Management Server
 * Node.js/Express server that:
 *   1. Serves all static files (index.html, widget.js, etc.)
 *   2. Provides a REST API for Bot CRUD operations
 *   3. Persists all bot configs in bots.json on disk
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 5001;
const BOTS_FILE = path.join(__dirname, '..', 'bots.json');
const BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' })); // Support large system prompts
app.use(express.static(path.join(__dirname, '..')));      // Serve static files

// Allow cross-origin requests (so any website can load the widget + fetch bot config)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Database connection (Vercel KV or File fallback)
let kv = null;
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    const { createClient } = require('@vercel/kv');
    kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    console.log('⚡ Connected to Vercel KV Storage');
  } catch (err) {
    console.warn('⚠️ @vercel/kv module not found, falling back to local files:', err.message);
  }
} else {
  console.log('📁 Using Local JSON Filesystem Storage');
}

async function loadBots() {
  if (kv) {
    try {
      const bots = await kv.get('bots');
      return bots || {};
    } catch (e) {
      console.error('Error reading bots from KV, falling back to file:', e.message);
    }
  }
  try {
    if (!fs.existsSync(BOTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading bots.json:', e.message);
    return {};
  }
}

async function saveBots(bots) {
  if (kv) {
    try {
      await kv.set('bots', bots);
      return;
    } catch (e) {
      console.error('Error writing bots to KV, falling back to file:', e.message);
    }
  }
  fs.writeFileSync(BOTS_FILE, JSON.stringify(bots, null, 2), 'utf8');
}

async function loadBookings() {
  if (kv) {
    try {
      const bookings = await kv.get('bookings');
      return bookings || {};
    } catch (e) {
      console.error('Error reading bookings from KV, falling back to file:', e.message);
    }
  }
  try {
    if (!fs.existsSync(BOOKINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading bookings.json:', e.message);
    return {};
  }
}

async function saveBookings(bookings) {
  if (kv) {
    try {
      await kv.set('bookings', bookings);
      return;
    } catch (e) {
      console.error('Error writing bookings to KV, falling back to file:', e.message);
    }
  }
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf8');
}

// ── Email Notification System ────────────────────────────────────────────────

async function sendBookingEmails(bot, booking, serverBaseUrl) {
  const emailConfig = bot.emailConfig || {};
  const receiverEmail = emailConfig.receiverEmail || '';
  const apiKey = emailConfig.resendApiKey || '';
  const senderEmail = emailConfig.senderEmail || 'onboarding@resend.dev';

  const bizName = bot.name || 'Our Business';
  const customerEmail = booking.contact;

  // Build portal URL so owner can view all their leads directly (bookmarkable)
  const portalUrl = serverBaseUrl
    ? `${serverBaseUrl}/leads.html?botId=${bot.id}`
    : null;

  // Format date nicely
  let friendlyDate = booking.date;
  try {
    friendlyDate = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch (e) {}

  // 1. Owner Notification Email (rich, beautiful design with portal link)
  const ownerSubject = `New Booking Request: ${booking.name} — ${bizName}`;
  const ownerHtml = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 32px;">
        <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">LuminaBot — New Lead Alert</div>
        <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">New Appointment Request</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">A visitor just submitted a booking at <strong>${bizName}</strong></p>
      </div>
      <div style="padding:28px 32px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
          <h2 style="margin:0 0 16px;font-size:15px;color:#1e293b;font-weight:700;">Customer Details</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;width:38%;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Name</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:700;color:#1e293b;">${booking.name}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Contact</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#6366f1;">${booking.contact}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Date</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#1e293b;">${friendlyDate}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:${booking.notes ? '1px solid #e2e8f0' : 'none'};font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Time</td>
              <td style="padding:10px 0;border-bottom:${booking.notes ? '1px solid #e2e8f0' : 'none'};font-size:14px;font-weight:600;color:#1e293b;">${booking.time}</td>
            </tr>
            ${booking.notes ? `<tr>
              <td style="padding:10px 0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Notes</td>
              <td style="padding:10px 0;font-size:14px;color:#475569;font-style:italic;">"${booking.notes}"</td>
            </tr>` : ''}
          </table>
        </div>
        <p style="color:#475569;font-size:14px;margin:0 0 20px;line-height:1.6;">
          Please contact <strong>${booking.contact}</strong> to confirm this appointment at your earliest convenience.
        </p>
        ${portalUrl ? `
        <div style="text-align:center;margin:24px 0;">
          <a href="${portalUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">
            View All Bookings Portal
          </a>
          <p style="font-size:11px;color:#94a3b8;margin:8px 0 0;">Bookmark this link to check all leads anytime</p>
        </div>` : ''}
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
        <p style="font-size:11px;color:#94a3b8;margin:0;">Auto-sent by <strong>LuminaBot</strong> on behalf of ${bizName}.</p>
      </div>
    </div>
  `;

  // 2. Compile Customer Confirmation
  const customerSubject = `Confirmation: Your booking request at ${bizName}`;
  const customerHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #10b981; margin-top: 0;">Appointment Request Received</h2>
      <p style="color: #475569;">Hi ${booking.name},</p>
      <p style="color: #475569;">Thank you for scheduling a visit at <strong>${bizName}</strong>. We have received your booking details and will contact you shortly to confirm your appointment.</p>
      
      <div style="border: 1px solid #f1f5f9; background: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; font-size: 14px; color: #0f172a;">Requested Time Details</h3>
        <p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>Date:</strong> ${booking.date}</p>
        <p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>Time:</strong> ${booking.time}</p>
        ${booking.notes ? `<p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>Notes:</strong> ${booking.notes}</p>` : ''}
      </div>
      
      <p style="color: #475569; font-size: 13px;">If you need to change or cancel this request, please reply to this email.</p>
      
      <div style="font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 15px; margin-top: 30px;">
        Best regards,<br>
        The Team at ${bizName}
      </div>
    </div>
  `;

  // Log to server terminal
  console.log(`
┌──────────────────────────────────────────────────────────┐
│ 📧 EMAIL DISPATCH SIMULATOR                              │
├──────────────────────────────────────────────────────────┤
│ FROM: ${senderEmail}
│ TO:   [Owner] ${receiverEmail || '(Not set - owner notification skipped)'}
│ SUBJ: ${ownerSubject}
├──────────────────────────────────────────────────────────┤
│ TO:   [Visitor] ${customerEmail}
│ SUBJ: ${customerSubject}
└──────────────────────────────────────────────────────────┘
  `);

  if (!apiKey) {
    console.log('ℹ️  No Resend API Key configured for this bot. Email sending was simulated.');
    return;
  }

  // Attempt real email delivery using Resend API (via native Node fetch)
  try {
    const promises = [];

    // Send notification to owner (if receiverEmail is specified)
    if (receiverEmail) {
      promises.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `LuminaBot <${senderEmail}>`,
            to: [receiverEmail],
            subject: ownerSubject,
            html: ownerHtml
          })
        }).then(async r => {
          if (!r.ok) {
            const errText = await r.text();
            console.error('Resend Owner Email Error:', errText);
          } else {
            console.log('✅ Lead notification email sent to owner successfully!');
          }
        })
      );
    }

    // Send confirmation to customer (if email format seems valid)
    if (customerEmail && customerEmail.includes('@')) {
      promises.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `${bizName} <${senderEmail}>`,
            to: [customerEmail],
            subject: customerSubject,
            html: customerHtml
          })
        }).then(async r => {
          if (!r.ok) {
            const errText = await r.text();
            console.error('Resend Customer Email Error:', errText);
          } else {
            console.log('✅ Confirmation email sent to customer successfully!');
          }
        })
      );
    }

    await Promise.all(promises);
  } catch (err) {
    console.error('❌ Failed to send emails via Resend API:', err.message);
  }
}

function generateBotId(name, website) {
  // Generate a clean, human-readable bot ID from the bot name or website domain
  const base = (name || website || 'bot')
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/, '')
    .replace(/\.[a-z]+.*$/, '')       // remove TLD
    .replace(/[^a-z0-9]/g, '-')       // replace special chars
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 20);
  const suffix = Math.random().toString(36).substring(2, 7); // 5-char random suffix
  return `${base}-${suffix}`;
}

// ── API Routes ───────────────────────────────────────────────────────────────

// GET /api/bots — List all bots (summary, no huge system prompt in list)
app.get('/api/bots', async (req, res) => {
  const bots = await loadBots();
  const summary = Object.values(bots).map(bot => ({
    id: bot.id,
    name: bot.name,
    avatar: bot.avatar,
    color: bot.color,
    website: bot.website,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  }));
  // Sort newest first
  summary.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ bots: summary, total: summary.length });
});

// GET /api/bots/:id — Get full bot config (used by widget.js to load a bot)
app.get('/api/bots/:id', async (req, res) => {
  const bots = await loadBots();
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json(bot);
});

// POST /api/bots — Create a new bot, returns the generated bot ID
app.post('/api/bots', async (req, res) => {
  const bots = await loadBots();
  const data = req.body;

  if (!data.name && !data.website) {
    return res.status(400).json({ error: 'Bot name or website is required' });
  }

  const id = generateBotId(data.name, data.website);
  const now = new Date().toISOString();

  const bot = {
    id,
    name: data.name || 'Unnamed Bot',
    avatar: data.avatar || '🤖',
    color: data.color || '#0ea5e9',
    welcomeMsg: data.welcomeMsg || 'Hi! How can I help you today?',
    systemPrompt: data.systemPrompt || '',
    apiKey: data.apiKey || 'DEMO',
    calendlyUrl: data.calendlyUrl || '',
    website: data.website || '',
    createdAt: now,
    updatedAt: now,
  };

  bots[id] = bot;
  await saveBots(bots);

  console.log(`✅ Bot created: "${bot.name}" (${id})`);
  res.status(201).json({ id, bot });
});

// PUT /api/bots/:id — Update an existing bot
app.put('/api/bots/:id', async (req, res) => {
  const bots = await loadBots();
  const existing = bots[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Bot not found' });

  const updated = {
    ...existing,
    ...req.body,
    id: existing.id,           // ID is immutable
    createdAt: existing.createdAt, // Preserve creation date
    updatedAt: new Date().toISOString(),
  };

  bots[req.params.id] = updated;
  await saveBots(bots);

  console.log(`✏️  Bot updated: "${updated.name}" (${req.params.id})`);
  res.json({ id: req.params.id, bot: updated });
});

// DELETE /api/bots/:id — Delete a bot
app.delete('/api/bots/:id', async (req, res) => {
  const bots = await loadBots();
  if (!bots[req.params.id]) return res.status(404).json({ error: 'Bot not found' });
  const name = bots[req.params.id].name;
  delete bots[req.params.id];
  await saveBots(bots);
  console.log(`🗑️  Bot deleted: "${name}" (${req.params.id})`);
  res.json({ success: true });
});

// ── Booking API Routes ───────────────────────────────────────────────────────

// GET /api/bots/:id/bookings — Get all bookings for a specific bot
app.get('/api/bots/:id/bookings', async (req, res) => {
  const bookings = await loadBookings();
  const botBookings = Object.values(bookings).filter(b => b.botId === req.params.id);
  // Sort newest first
  botBookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ bookings: botBookings });
});

// POST /api/bots/:id/bookings — Add a booking for a specific bot
app.post('/api/bots/:id/bookings', async (req, res) => {
  const bots = await loadBots();
  const bot = bots[req.params.id];
  // Allow bookings for 'DEMO' or temporary/unregistered bots in preview mode
  const botName = bot ? bot.name : (req.params.id === 'DEMO' || req.params.id === 'undefined' ? 'Demo Bot' : 'Unknown Bot');

  const data = req.body;
  if (!data.name || !data.contact || !data.date || !data.time) {
    return res.status(400).json({ error: 'Name, contact info, date, and time are required' });
  }

  const bookings = await loadBookings();
  const id = 'booking-' + Math.random().toString(36).substring(2, 7) + Date.now().toString(36);
  const now = new Date().toISOString();

  const newBooking = {
    id,
    botId: req.params.id,
    botName,
    name: data.name,
    contact: data.contact,
    date: data.date,
    time: data.time,
    notes: data.notes || '',
    createdAt: now
  };

  bookings[id] = newBooking;
  await saveBookings(bookings);

  console.log(`📅 Booking created for bot "${newBooking.botName}": ${newBooking.name} on ${newBooking.date} at ${newBooking.time}`);
  
  // Trigger email sending in the background
  const targetBot = bot || {
    id: req.params.id,
    name: botName,
    emailConfig: {}
  };
  // Derive the server's public base URL from the request (used for portal link in email)
  const serverBaseUrl = `${req.protocol}://${req.get('host')}`;
  sendBookingEmails(targetBot, newBooking, serverBaseUrl);

  res.status(201).json({ success: true, booking: newBooking });
});

// DELETE /api/bookings/:id — Delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
  const bookings = await loadBookings();
  if (!bookings[req.params.id]) return res.status(404).json({ error: 'Booking not found' });
  const botId = bookings[req.params.id].botId;
  delete bookings[req.params.id];
  await saveBookings(bookings);
  console.log(`🗑️  Booking deleted: ${req.params.id}`);
  res.json({ success: true });
});

// DELETE /api/bots/:id/bookings — Clear all bookings for a specific bot
app.delete('/api/bots/:id/bookings', async (req, res) => {
  const bookings = await loadBookings();
  const filtered = {};
  Object.keys(bookings).forEach(key => {
    if (bookings[key].botId !== req.params.id) {
      filtered[key] = bookings[key];
    }
  });
  await saveBookings(filtered);
  console.log(`🗑️  All bookings cleared for bot: ${req.params.id}`);
  res.json({ success: true });
});

// ── Server-Side Scraping API ─────────────────────────────────────────────────
// GET /api/scrape?url=... — Fetch a URL server-side (bypasses browser CORS)
app.get('/api/scrape', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

  try {
    const html = await serverFetch(targetUrl);
    res.type('text/html').send(html);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/scrape/links?url=... — Return all same-domain links found on a page
app.get('/api/scrape/links', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

  try {
    const html = await serverFetch(targetUrl);
    const { URL: WHATWG_URL } = require('url');
    const baseObj = new WHATWG_URL(targetUrl);
    
    // Simple regex to find href attributes — no DOMParser in Node
    const hrefRegex = /href=["']([^"'#?][^"']*)["']/gi;
    const links = new Set();
    let m;
    while ((m = hrefRegex.exec(html)) !== null) {
      try {
        const abs = new WHATWG_URL(m[1], targetUrl);
        const clean = abs.origin + abs.pathname;
        const cleanPath = abs.pathname.toLowerCase();
        const isWpOrFeed = /(wp-json|wp-content|wp-includes|wp-admin|xmlrpc)/i.test(cleanPath) ||
                           /(\/feed\/?$|\/feed\/)/i.test(cleanPath) ||
                           /(\/comments\/?$|\/comments\/)/i.test(cleanPath);
                           
        if (abs.hostname === baseObj.hostname && 
            clean !== targetUrl && 
            !/\.(pdf|zip|png|jpg|jpeg|docx|xml|css|js|webp|ico|svg|gif)$/i.test(abs.pathname) &&
            !isWpOrFeed) {
          links.add(clean);
        }
      } catch (e) {}
    }

    res.json({ links: Array.from(links) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Helper: fetch a URL server-side, following redirects up to 5 times
function serverFetch(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    
    const parsed = new (require('url').URL)(url);
    const proto = parsed.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LuminaBot-Scraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity', // avoid gzip to keep things simple
        'Connection': 'close'
      },
      timeout: 10000
    };
    
    const req = proto.request(options, (resp) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        const newUrl = new (require('url').URL)(resp.headers.location, url).toString();
        resp.resume(); // discard body
        return serverFetch(newUrl, redirectCount + 1).then(resolve).catch(reject);
      }
      
      if (resp.statusCode && resp.statusCode >= 400) {
        resp.resume();
        return reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
      }
      
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', chunk => { body += chunk; });
      resp.on('end', () => resolve(body));
    });
    
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// ── Start Server / Export for Serverless ─────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   🤖 LuminaBot Server running            ║
║   http://localhost:${PORT}                 ║
║                                          ║
║   API Endpoints:                         ║
║   GET    /api/bots          (list all)   ║
║   GET    /api/bots/:id      (get one)    ║
║   POST   /api/bots          (create)     ║
║   PUT    /api/bots/:id      (update)     ║
║   DELETE /api/bots/:id      (delete)     ║
╚══════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
