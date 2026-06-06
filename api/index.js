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
// Database paths (local vs writable /tmp fallback for serverless read-only environments)
const LOCAL_BOTS_FILE = path.join(__dirname, '..', 'bots.json');
const LOCAL_BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');
const TMP_BOTS_FILE = '/tmp/bots.json';
const TMP_BOOKINGS_FILE = '/tmp/bookings.json';

function getBotsFilePath() {
  try {
    const file = fs.existsSync(LOCAL_BOTS_FILE) ? LOCAL_BOTS_FILE : path.dirname(LOCAL_BOTS_FILE);
    fs.accessSync(file, fs.constants.W_OK);
    return LOCAL_BOTS_FILE;
  } catch (e) {
    return TMP_BOTS_FILE;
  }
}

function getBookingsFilePath() {
  try {
    const file = fs.existsSync(LOCAL_BOOKINGS_FILE) ? LOCAL_BOOKINGS_FILE : path.dirname(LOCAL_BOOKINGS_FILE);
    fs.accessSync(file, fs.constants.W_OK);
    return LOCAL_BOOKINGS_FILE;
  } catch (e) {
    return TMP_BOOKINGS_FILE;
  }
}

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
    const file = getBotsFilePath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Error reading bots file:', e.message);
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
  try {
    const file = getBotsFilePath();
    fs.writeFileSync(file, JSON.stringify(bots, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing bots file:', e.message);
    throw e;
  }
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
    const file = getBookingsFilePath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Error reading bookings file:', e.message);
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
  try {
    const file = getBookingsFilePath();
    fs.writeFileSync(file, JSON.stringify(bookings, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing bookings file:', e.message);
    throw e;
  }
}

// Helper to send a JSON POST request to a webhook URL
function postWebhook(url, payload) {
  return new Promise((resolve) => {
    try {
      if (!url) return resolve(false);

      if (typeof fetch === 'function') {
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })
        .then(res => {
          if (!res.ok) {
            console.warn(`[Webhook] POST to ${url} failed with status: ${res.status}`);
          } else {
            console.log(`[Webhook] Sent successfully to ${url}`);
          }
          resolve(res.ok);
        })
        .catch(err => {
          console.error(`[Webhook] Error sending to ${url} via fetch:`, err.message);
          resolve(false);
        });
        return;
      }

      // Fallback using Node.js built-in modules
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      const bodyString = JSON.stringify(payload);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyString)
        }
      };

      const req = client.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Webhook] Sent successfully to ${url} (fallback)`);
            resolve(true);
          } else {
            console.warn(`[Webhook] POST to ${url} failed with status: ${res.statusCode} (fallback)`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[Webhook] Error sending to ${url} via fallback:`, err.message);
        resolve(false);
      });

      req.write(bodyString);
      req.end();
    } catch (e) {
      console.error(`[Webhook] Initialization error for ${url}:`, e.message);
      resolve(false);
    }
  });
}

// ── Email Notification System ────────────────────────────────────────────────

async function sendBookingEmails(bot, booking, serverBaseUrl) {
  const emailConfig = bot.emailConfig || {};
  const receiverEmail = emailConfig.receiverEmail || '';
  const apiKey = emailConfig.resendApiKey || '';
  const senderEmail = emailConfig.senderEmail || 'onboarding@resend.dev';

  const bizName = bot.name || 'Our Business';
  const customerEmail = booking.contact;

  // Detect form type from booking.notes prefix
  let leadType = 'appointment';
  let cleanNotes = booking.notes || '';
  
  if (cleanNotes.startsWith('[Support Ticket] ')) {
    leadType = 'ticket';
    cleanNotes = cleanNotes.substring('[Support Ticket] '.length);
  } else if (cleanNotes.startsWith('[Quote Request] ')) {
    leadType = 'quote';
    cleanNotes = cleanNotes.substring('[Quote Request] '.length);
  } else if (cleanNotes.startsWith('[Hotel Booking] ')) {
    leadType = 'hotel';
    cleanNotes = cleanNotes.substring('[Hotel Booking] '.length);
  } else if (cleanNotes.startsWith('[Medical Appointment] ')) {
    leadType = 'medical';
    cleanNotes = cleanNotes.substring('[Medical Appointment] '.length);
  } else if (cleanNotes.startsWith('[E-commerce Order] ')) {
    leadType = 'order';
    cleanNotes = cleanNotes.substring('[E-commerce Order] '.length);
  } else if (cleanNotes.startsWith('[Appointment] ')) {
    cleanNotes = cleanNotes.substring('[Appointment] '.length);
  }

  // Format date nicely
  let friendlyDate = booking.date;
  try {
    friendlyDate = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch (e) {}

  // Customize subjects and titles based on leadType
  let ownerSubject = `New Booking Request: ${booking.name} — ${bizName}`;
  let ownerTitle = 'New Appointment Request';
  let ownerIntro = `A visitor just submitted a booking at <strong>${bizName}</strong>`;
  let notesLabel = 'Notes';
  let dateFieldLabel = 'Date';
  let timeFieldLabel = 'Time';

  let customerSubject = `Confirmation: Your booking request at ${bizName}`;
  let customerTitle = 'Appointment Request Received';
  let customerBody = `Thank you for scheduling a visit at <strong>${bizName}</strong>. We have received your booking details and will contact you shortly to confirm your appointment.`;

  if (leadType === 'ticket') {
    ownerSubject = `New Support Ticket: ${booking.name} — ${bizName}`;
    ownerTitle = '🎫 New Support Ticket';
    ownerIntro = `A visitor just submitted a support ticket for <strong>${bizName}</strong>`;
    notesLabel = 'Issue Description';
    customerSubject = `Support Ticket Logged: #${booking.id.substring(0, 8)} at ${bizName}`;
    customerTitle = 'Support Ticket Logged';
    customerBody = `Thank you for reporting your issue to <strong>${bizName}</strong>. We have successfully logged your support ticket (ID: #${booking.id.substring(0, 8)}) and our team will contact you shortly to help resolve it.`;
  } else if (leadType === 'quote') {
    ownerSubject = `New Quote Request: ${booking.name} — ${bizName}`;
    ownerTitle = '📋 New Quote Request';
    ownerIntro = `A visitor just requested a custom quote from <strong>${bizName}</strong>`;
    notesLabel = 'Project Details';
    customerSubject = `Quote Request Received: #${booking.id.substring(0, 8)} at ${bizName}`;
    customerTitle = 'Quote Request Received';
    customerBody = `Thank you for requesting a custom quote from <strong>${bizName}</strong>. We have received your project details and our team will get back to you shortly with pricing.`;
  } else if (leadType === 'hotel') {
    ownerSubject = `New Hotel Booking Request: ${booking.name} — ${bizName}`;
    ownerTitle = '🏨 New Stay Reservation';
    ownerIntro = `A visitor just requested a room booking at <strong>${bizName}</strong>`;
    notesLabel = 'Stay Details & Guests';
    dateFieldLabel = 'Check-in Date';
    timeFieldLabel = 'Arrival Time';
    customerSubject = `Stay Reservation Request: Your room at ${bizName}`;
    customerTitle = 'Stay Reservation Request Received';
    customerBody = `Thank you for requesting a room stay at <strong>${bizName}</strong>. We have received your check-in dates and preferences and will contact you shortly to confirm your stay.`;
  } else if (leadType === 'medical') {
    ownerSubject = `New Patient Appointment: ${booking.name} — ${bizName}`;
    ownerTitle = '🏥 New Patient Appointment';
    ownerIntro = `A patient just scheduled a doctor appointment at <strong>${bizName}</strong>`;
    notesLabel = 'Symptoms / Reason';
    dateFieldLabel = 'Preferred Date';
    timeFieldLabel = 'Time Slot';
    customerSubject = `Appointment Request: Your visit at ${bizName}`;
    customerTitle = 'Appointment Request Received';
    customerBody = `Thank you for requesting a doctor appointment at <strong>${bizName}</strong>. We have received your details and our team will reach out to finalize your time slot.`;
  } else if (leadType === 'order') {
    ownerSubject = `New E-commerce Order: ${booking.name} — ${bizName}`;
    ownerTitle = '🛍️ New Order Received';
    ownerIntro = `A customer just placed an order at <strong>${bizName}</strong>`;
    notesLabel = 'Order Details & Allergies';
    dateFieldLabel = 'Delivery Date';
    timeFieldLabel = 'Delivery Time';
    customerSubject = `Order Confirmed: #${booking.id.substring(0, 8)} from ${bizName}`;
    customerTitle = 'Order Confirmed';
    customerBody = `Thank you for placing an order with <strong>${bizName}</strong>. We are preparing your items and will contact you for delivery or dispatch.`;
  }

  // 1. Owner Notification Email (rich, beautiful design with portal link)
  const portalUrl = serverBaseUrl
    ? `${serverBaseUrl}/leads.html?botId=${bot.id}`
    : null;

  const ownerHtml = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 32px;">
        <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">LuminaBot — New Lead Alert</div>
        <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">${ownerTitle}</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${ownerIntro}</p>
      </div>
      <div style="padding:28px 32px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
          <h2 style="margin:0 0 16px;font-size:15px;color:#1e293b;font-weight:700;">Lead Details</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;width:38%;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Name</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:700;color:#1e293b;">${booking.name}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Contact</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#6366f1;">${booking.contact}</td>
            </tr>
            ${booking.time !== 'N/A' ? `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${dateFieldLabel}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#1e293b;">${friendlyDate}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:${cleanNotes ? '1px solid #e2e8f0' : 'none'};font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${timeFieldLabel}</td>
              <td style="padding:10px 0;border-bottom:${cleanNotes ? '1px solid #e2e8f0' : 'none'};font-size:14px;font-weight:600;color:#1e293b;">${booking.time}</td>
            </tr>
            ` : `
            <tr>
              <td style="padding:10px 0;border-bottom:${cleanNotes ? '1px solid #e2e8f0' : 'none'};font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Date Created</td>
              <td style="padding:10px 0;border-bottom:${cleanNotes ? '1px solid #e2e8f0' : 'none'};font-size:14px;font-weight:600;color:#1e293b;">${friendlyDate}</td>
            </tr>
            `}
            ${cleanNotes ? `<tr>
              <td style="padding:10px 0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${notesLabel}</td>
              <td style="padding:10px 0;font-size:14px;color:#475569;font-style:italic;">"${cleanNotes}"</td>
            </tr>` : ''}
          </table>
        </div>
        <p style="color:#475569;font-size:14px;margin:0 0 20px;line-height:1.6;">
          Please contact <strong>${booking.contact}</strong> to process this request at your earliest convenience.
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
  const customerHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #10b981; margin-top: 0;">${customerTitle}</h2>
      <p style="color: #475569;">Hi ${booking.name},</p>
      <p style="color: #475569;">${customerBody}</p>
      
      <div style="border: 1px solid #f1f5f9; background: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; font-size: 14px; color: #0f172a;">Request Details</h3>
        ${booking.time !== 'N/A' ? `
        <p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>${dateFieldLabel}:</strong> ${booking.date}</p>
        <p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>${timeFieldLabel}:</strong> ${booking.time}</p>
        ` : `
        <p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>Date Submitted:</strong> ${booking.date}</p>
        `}
        ${cleanNotes ? `<p style="margin: 4px 0; font-size: 13px; color: #334155;"><strong>${notesLabel}:</strong> ${cleanNotes}</p>` : ''}
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

// Helper to catch async errors in Express 4 handlers and forward them to global error middleware
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ── API Routes ───────────────────────────────────────────────────────────────

// GET /api/bots — List all bots (summary, no huge system prompt in list)
app.get('/api/bots', asyncHandler(async (req, res) => {
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
}));

// GET /api/bots/:id — Get full bot config (used by widget.js to load a bot)
app.get('/api/bots/:id', asyncHandler(async (req, res) => {
  const bots = await loadBots();
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json(bot);
}));

// POST /api/bots — Create a new bot, returns the generated bot ID
app.post('/api/bots', asyncHandler(async (req, res) => {
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
    bookingMethod: data.bookingMethod || 'builtin',
    businessType: data.businessType || 'general',
    webhookUrl: data.webhookUrl || '',
    inventory: data.inventory || [],
    emailConfig: data.emailConfig || {
      receiverEmail: '',
      resendApiKey: '',
      senderEmail: 'onboarding@resend.dev'
    }
  };

  bots[id] = bot;
  await saveBots(bots);

  console.log(`✅ Bot created: "${bot.name}" (${id})`);
  res.status(201).json({ id, bot });
}));

// PUT /api/bots/:id — Update an existing bot
app.put('/api/bots/:id', asyncHandler(async (req, res) => {
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
}));

// DELETE /api/bots/:id — Delete a bot
app.delete('/api/bots/:id', asyncHandler(async (req, res) => {
  const bots = await loadBots();
  if (!bots[req.params.id]) return res.status(404).json({ error: 'Bot not found' });
  const name = bots[req.params.id].name;
  delete bots[req.params.id];
  await saveBots(bots);
  console.log(`🗑️  Bot deleted: "${name}" (${req.params.id})`);
  res.json({ success: true });
}));

// ── Booking API Routes ───────────────────────────────────────────────────────

// GET /api/bots/:id/bookings — Get all bookings for a specific bot
app.get('/api/bots/:id/bookings', asyncHandler(async (req, res) => {
  const bookings = await loadBookings();
  const botBookings = Object.values(bookings).filter(b => b.botId === req.params.id);
  // Sort newest first
  botBookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ bookings: botBookings });
}));

// POST /api/bots/:id/bookings — Add a booking for a specific bot
app.post('/api/bots/:id/bookings', asyncHandler(async (req, res) => {
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

  const hasWebhook = (bot && bot.webhookUrl) ? 'pending' : 'na';

  const newBooking = {
    id,
    botId: req.params.id,
    botName,
    name: data.name,
    contact: data.contact,
    date: data.date,
    time: data.time,
    notes: data.notes || '',
    webhookStatus: hasWebhook,
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

  // Trigger webhook in the background if configured
  if (targetBot.webhookUrl) {
    // Determine lead type and clean notes for payload
    let leadType = 'appointment';
    let cleanNotes = newBooking.notes || '';
    if (cleanNotes.startsWith('[Support Ticket] ')) {
      leadType = 'ticket';
      cleanNotes = cleanNotes.substring('[Support Ticket] '.length);
    } else if (cleanNotes.startsWith('[Quote Request] ')) {
      leadType = 'quote';
      cleanNotes = cleanNotes.substring('[Quote Request] '.length);
    } else if (cleanNotes.startsWith('[Hotel Booking] ')) {
      leadType = 'hotel';
      cleanNotes = cleanNotes.substring('[Hotel Booking] '.length);
    } else if (cleanNotes.startsWith('[Medical Appointment] ')) {
      leadType = 'medical';
      cleanNotes = cleanNotes.substring('[Medical Appointment] '.length);
    } else if (cleanNotes.startsWith('[E-commerce Order] ')) {
      leadType = 'order';
      cleanNotes = cleanNotes.substring('[E-commerce Order] '.length);
    } else if (cleanNotes.startsWith('[Appointment] ')) {
      cleanNotes = cleanNotes.substring('[Appointment] '.length);
    }

    const webhookPayload = {
      event: 'lead_captured',
      bookingId: newBooking.id,
      botId: newBooking.botId,
      botName: newBooking.botName,
      businessType: targetBot.businessType || 'general',
      leadType: leadType,
      name: newBooking.name,
      contact: newBooking.contact,
      date: newBooking.date,
      time: newBooking.time,
      notes: newBooking.notes,
      cleanNotes: cleanNotes,
      createdAt: newBooking.createdAt
    };

    postWebhook(targetBot.webhookUrl, webhookPayload).then(async (success) => {
      try {
        const currentBookings = await loadBookings();
        if (currentBookings[id]) {
          currentBookings[id].webhookStatus = success ? 'success' : 'failed';
          await saveBookings(currentBookings);
          console.log(`📅 Webhook status updated for booking ${id}: ${success ? 'success' : 'failed'}`);
        }
      } catch (err) {
        console.error('Error updating webhook status in database:', err);
      }
    });
  }

  res.status(201).json({ success: true, booking: newBooking });
}));

// DELETE /api/bookings/:id — Delete a booking
app.delete('/api/bookings/:id', asyncHandler(async (req, res) => {
  const bookings = await loadBookings();
  if (!bookings[req.params.id]) return res.status(404).json({ error: 'Booking not found' });
  const botId = bookings[req.params.id].botId;
  delete bookings[req.params.id];
  await saveBookings(bookings);
  console.log(`🗑️  Booking deleted: ${req.params.id}`);
  res.json({ success: true });
}));

// DELETE /api/bots/:id/bookings — Clear all bookings for a specific bot
app.delete('/api/bots/:id/bookings', asyncHandler(async (req, res) => {
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
}));

// ── Server-Side Scraping API ─────────────────────────────────────────────────
// GET /api/scrape?url=... — Fetch a URL server-side (bypasses browser CORS)
app.get('/api/scrape', asyncHandler(async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

  try {
    const buffer = await serverFetch(targetUrl);
    if (targetUrl.toLowerCase().endsWith('.pdf')) {
      res.type('application/pdf').send(buffer);
    } else {
      res.type('text/html').send(buffer.toString('utf8'));
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

// GET /api/scrape/links?url=... — Return all same-domain links found on a page
app.get('/api/scrape/links', asyncHandler(async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

  try {
    const buffer = await serverFetch(targetUrl);
    const html = buffer.toString('utf8');
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
            !/\.(zip|png|jpg|jpeg|docx|xml|css|js|webp|ico|svg|gif)$/i.test(abs.pathname) &&
            !isWpOrFeed) {
          links.add(clean);
        }
      } catch (e) {}
    }

    res.json({ links: Array.from(links) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/pdf',
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
      
      const chunks = [];
      resp.on('data', chunk => { chunks.push(chunk); });
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// POST /api/test-webhook — Receiver endpoint to test webhooks locally
app.post('/api/test-webhook', (req, res) => {
  console.log('📬 [Test Webhook Payload Received]:', JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('🔴 Server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

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
