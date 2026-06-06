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
const crypto = require('crypto');

const app = express();
const PORT = 5001;

// Ensure temp_audio directory exists for caching TTS files
const tempAudioDir = path.join(__dirname, '..', 'temp_audio');
if (!fs.existsSync(tempAudioDir)) {
  fs.mkdirSync(tempAudioDir, { recursive: true });
}
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
app.use(express.urlencoded({ extended: true }));
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

// --- Voice AI Receptionist (LuminaVoice) ---
const callHistories = {}; // CallSid -> history
const callWhispers = {}; // CallSid -> German summary
const activeAlerts = {}; // bookingId -> alertState

// POST /api/voice/inbound — Inbound customer call webhook
app.post(['/api/voice/inbound', '/api/voice/inbound/:botId'], asyncHandler(async (req, res) => {
  let botId = req.params.botId || req.query.botId;
  const bots = await loadBots();
  let bot = bots[botId];

  // Try auto-matching based on Twilio "To" number
  if (!bot) {
    const toNum = req.body.To || '';
    for (const id in bots) {
      if (bots[id].useVoiceAgent && bots[id].ownerPhone === toNum) {
        bot = bots[id];
        botId = id;
        break;
      }
    }
  }

  // Fallback to first bot with Voice Agent enabled if still no bot matched
  if (!bot) {
    for (const id in bots) {
      if (bots[id].useVoiceAgent) {
        bot = bots[id];
        botId = id;
        break;
      }
    }
  }

  if (!bot) {
    res.type('text/xml');
    return res.send(`
      <Response>
        <Say voice="Polly.Amy">Hello. The restaurant voice assistant is currently disabled. Goodbye.</Say>
        <Hangup/>
      </Response>
    `);
  }

  const callSid = req.body.CallSid || 'sim-call-' + Math.random().toString(36).substring(7);
  const speechText = req.body.SpeechResult || req.query.SpeechResult;
  
  if (!callHistories[callSid]) {
    callHistories[callSid] = [];
  }
  const history = callHistories[callSid];

  // Welcome caller if history is empty
  if (!speechText && history.length === 0) {
    const welcome = bot.welcomeMsg || "Hello! Welcome. How can I help you today?";
    history.push({ role: 'model', text: welcome });
    
    if (bot.simulateVoice) {
      console.log(`\n======================================================`);
      console.log(`📞 [LuminaVoice INBOUND SIMULATION] Call started: ${callSid}`);
      console.log(`🤖 AI Receptionist: "${welcome}"`);
      console.log(`======================================================\n`);
    }

    res.type('text/xml');
    const welcomePlay = await getVoiceResponseTwiML(welcome, bot, req);
    return res.send(`
      <Response>
        ${welcomePlay}
        <Gather input="speech" action="/api/voice/inbound?botId=${botId}" method="POST" timeout="5" speechTimeout="auto"/>
      </Response>
    `);
  }

  // User input
  if (speechText) {
    history.push({ role: 'user', text: speechText });
    if (bot.simulateVoice) {
      console.log(`🗣️ Customer: "${speechText}"`);
    }
  }

  // Gemini API Call
  const apiKey = (bot.apiKey && bot.apiKey !== 'DEMO') ? bot.apiKey : process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'DEMO') {
    let fallbackText = "I understand. Let me check that for you.";
    if (speechText && (speechText.toLowerCase().includes('out of') || speechText.toLowerCase().includes('stock'))) {
      let item = "Pizza Margherita";
      if (speechText.toLowerCase().includes('pils')) {
        item = "Pils Beer";
      }
      fallbackText = `Okay, I will update that item status. [STOCK_UPDATE: item=${item}, status=out_of_stock]`;
    } else if (speechText && (speechText.toLowerCase().includes('book') || speechText.toLowerCase().includes('reserve'))) {
      const bDate = new Date();
      bDate.setDate(bDate.getDate() + 1);
      const formattedDate = bDate.toISOString().split('T')[0];
      fallbackText = `I have registered your booking for ${formattedDate} at 19:00 under the name test caller. [BOOKING: name=test caller, date=${formattedDate}, time=19:00, guests=2]`;
    } else if (speechText && (speechText.toLowerCase().includes('chef') || speechText.toLowerCase().includes('manager') || speechText.toLowerCase().includes('party'))) {
      fallbackText = `I will connect you to the restaurant chef now. [TRANSFER]`;
    } else {
      fallbackText = `Hello! You said: "${speechText}". For testing, say "book" to test booking alerts, or say "chef" to test whisper transferring.`;
    }
    return await handleAIResponse(fallbackText, bot, botId, callSid, req, res, history);
  }

  try {
    const contents = [];
    history.forEach(h => {
      contents.push({
        role: h.role,
        parts: [{ text: h.text }]
      });
    });

    const cleanSystemPrompt = (bot.systemPrompt || '') + `
You are a professional, polite, and helpful voice receptionist named LuminaVoice answering calls for ${bot.name}.
Respond naturally, clearly, and extremely concisely (usually 1-2 sentences), as your text will be read by Text-to-Speech to a caller on a phone.
Never write raw currency symbols like € or $; format all prices as numerals + words (e.g., '180 Rupees' or '81 euros') so the reader reads them correctly.

BOOKINGS RULES:
If the user indicates they want to make a reservation or book a table, ask for their:
1. Name
2. Date and Time of booking
3. Number of guests
Once they provide all details, confirm the booking to the customer verbally AND append the command [BOOKING: name=..., date=..., time=..., guests=...] at the very end of your response to trigger the system alert call.
Example response: "Perfect! I have scheduled that booking for John on June 7th at 19:30 for 4 people. [BOOKING: name=John, date=2026-06-07, time=19:30, guests=4]"

TRANSFER / COMPLEX REQUESTS RULES:
If the customer wants to speak with the manager or chef, or has a complex request (e.g. cost reduction, custom event menu pricing, large parties of more than 15 people) that you cannot solve, tell them you are connecting them to the chef, and append the command [TRANSFER] at the very end.
Example response: "I'll transfer you to our kitchen chef to discuss cost reductions for your family party. Please hold. [TRANSFER]"

STOCK UPDATES RULES:
If the caller claims to be a staff member or owner and tells you to update stock status of a menu item (e.g. "we are out of pils" or "mark Margherita pizza as in stock"), acknowledge it, and append [STOCK_UPDATE: item=..., status=...] where status is either "in_stock" or "out_of_stock".
Example: "Understood, I will mark the Pils as out of stock now. [STOCK_UPDATE: item=Pils, status=out_of_stock]"
`;

    const payload = {
      contents: contents,
      systemInstruction: { parts: [{ text: cleanSystemPrompt }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiRes = await makeHttpsRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, payload);

    const aiText = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text || 'I am sorry, I am having trouble understanding.';
    await handleAIResponse(aiText, bot, botId, callSid, req, res, history);
  } catch (err) {
    console.error('🔴 Gemini completion error in voice webhook:', err.message);
    const fallbackText = "I am sorry, I am having trouble processing your request. Please hold.";
    await handleAIResponse(fallbackText, bot, botId, callSid, req, res, history);
  }
}));

// Helper to handle AI responses, parse commands, and output TwiML
async function handleAIResponse(aiText, bot, botId, callSid, req, res, history) {
  let spokenText = aiText;
  
  // 1. Detect STOCK_UPDATE trigger
  const stockMatch = spokenText.match(/\[STOCK_UPDATE:\s*item=([^,\]]+),\s*status=([^\]]+)\]/i);
  if (stockMatch) {
    const itemName = stockMatch[1].trim();
    const newStatus = stockMatch[2].trim().toLowerCase();
    spokenText = spokenText.replace(/\[STOCK_UPDATE:[^\]]+\]/gi, '').trim();

    try {
      const bots = await loadBots();
      const currentBot = bots[botId];
      if (currentBot && currentBot.inventory) {
        let matched = false;
        currentBot.inventory.forEach(item => {
          if (item.name.toLowerCase() === itemName.toLowerCase() || 
              item.name.toLowerCase().includes(itemName.toLowerCase())) {
            item.stock = newStatus === 'in_stock' ? 'in_stock' : 'out_of_stock';
            matched = true;
          }
        });
        if (matched) {
          await saveBots(bots);
          console.log(`📦 [STOCK UPDATE SUCCESS]: Marked item matching "${itemName}" as ${newStatus} for Bot "${currentBot.name}"`);
        } else {
          console.warn(`📦 [STOCK UPDATE FAILED]: Could not find inventory item matching "${itemName}"`);
        }
      }
    } catch (e) {
      console.error('Error auto-updating stock:', e.message);
    }
  }

  // 2. Detect BOOKING trigger
  const bookingMatch = spokenText.match(/\[BOOKING:\s*name=([^,\]]+),\s*date=([^,\]]+),\s*time=([^,\]]+)(?:,\s*guests=([^\]]+))?\]/i);
  if (bookingMatch) {
    const name = bookingMatch[1].trim();
    const date = bookingMatch[2].trim();
    const time = bookingMatch[3].trim();
    const guests = bookingMatch[4] ? bookingMatch[4].trim() : '2';
    spokenText = spokenText.replace(/\[BOOKING:[^\]]+\]/gi, '').trim();

    const bookings = await loadBookings();
    const bookingId = 'booking-' + Math.random().toString(36).substring(2, 7) + Date.now().toString(36);
    const newBooking = {
      id: bookingId,
      botId: botId,
      botName: bot.name,
      name: name,
      contact: 'Voice Call (' + (req.body.From || 'Unknown Caller') + ')',
      date: date,
      time: time,
      notes: `Reservierung für ${guests} Personen (über Sprachassistent erstellt)`,
      webhookStatus: bot.webhookUrl ? 'pending' : 'na',
      createdAt: new Date().toISOString()
    };
    bookings[bookingId] = newBooking;
    await saveBookings(bookings);

    console.log(`📅 [Voice Booking Created] ID: ${bookingId} for Bot "${bot.name}"`);
    dispatchOutboundAlert(bot, newBooking);
  }

  // 3. Detect TRANSFER trigger
  const transferMatch = spokenText.includes('[TRANSFER]');
  let connectionTwiML = '';
  if (transferMatch) {
    spokenText = spokenText.replace('[TRANSFER]', '').trim();
    
    let whisperText = `Achtung Chef: Ein Kunde ruft an.`;
    const apiKey = (bot.apiKey && bot.apiKey !== 'DEMO') ? bot.apiKey : process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'DEMO') {
      try {
        const summaryPrompt = `
You are a translation and summarization system. Summarize this caller's request in German for the kitchen chef/restaurant owner.
Keep the summary under 15 words. Keep it professional.
Conversation:
${history.map(h => `${h.role === 'user' ? 'Customer' : 'AI'}: ${h.text}`).join('\n')}

Format: "Achtung Chef: Ein Kunde ruft an wegen [Zusammenfassung]. Ich verbinde jetzt."
`;
        const payload = {
          contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 128 }
        };
        const summaryRes = await makeHttpsRequest(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          payload
        );
        const germanText = summaryRes.candidates?.[0]?.content?.parts?.[0]?.text;
        if (germanText) whisperText = germanText.trim();
      } catch (err) {
        console.error('Error generating German whisper summary:', err.message);
      }
    } else {
      whisperText = `Achtung Chef: Ein Kunde möchte mit Ihnen sprechen. Ich verbinde jetzt.`;
    }

    callWhispers[callSid] = whisperText;
    
    if (bot.simulateVoice) {
      console.log(`\n======================================================`);
      console.log(`🔀 [LuminaVoice TRANSFER INITIATED]`);
      console.log(`📞 Connecting caller to Chef Phone: ${bot.ownerPhone}`);
      console.log(`🤫 Private Whisper to Chef (German): "${whisperText}"`);
      console.log(`======================================================\n`);
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const whisperUrl = `${protocol}://${host}/api/voice/whisper?callSid=${callSid}&botId=${botId}`;
    
    connectionTwiML = `
      <Dial>
        <Number url="${whisperUrl}">${bot.ownerPhone || '+31206166796'}</Number>
      </Dial>
    `;
  }

  history.push({ role: 'model', text: spokenText });
  if (bot.simulateVoice) {
    console.log(`🤖 AI Receptionist: "${spokenText}"`);
  }

  res.type('text/xml');
  const spokenPlay = await getVoiceResponseTwiML(spokenText, bot, req);
  if (transferMatch) {
    res.send(`
      <Response>
        ${spokenPlay}
        ${connectionTwiML}
      </Response>
    `);
  } else if (bookingMatch) {
    res.send(`
      <Response>
        ${spokenPlay}
        <Hangup/>
      </Response>
    `);
  } else {
    res.send(`
      <Response>
        ${spokenPlay}
        <Gather input="speech" action="/api/voice/inbound?botId=${botId}" method="POST" timeout="5" speechTimeout="auto"/>
      </Response>
    `);
  }
}

// POST /api/voice/whisper — Whisper route to read out the summary privately to the chef/owner before bridging
app.post('/api/voice/whisper', asyncHandler(async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const botId = req.query.botId || req.body.BotId;
  const bots = await loadBots();
  const bot = bots[botId] || {};
  const whisper = callWhispers[callSid] || "Achtung Chef: Ein Kunde wird mit Ihnen verbunden.";
  
  res.type('text/xml');
  const whisperPlay = await getVoiceResponseTwiML(whisper, bot, req, { language: 'de-DE' });
  res.send(`
    <Response>
      ${whisperPlay}
    </Response>
  `);
}));

// Outbound Alert confirmer and retry queue dispatcher
function dispatchOutboundAlert(bot, booking) {
  const bookingId = booking.id;
  
  if (!activeAlerts[bookingId]) {
    activeAlerts[bookingId] = {
      confirmed: false,
      attempts: 1,
      botId: bot.id,
      ownerPhone: bot.ownerPhone || '+31206166796',
      booking: booking
    };
  } else {
    activeAlerts[bookingId].attempts += 1;
  }

  const alertState = activeAlerts[bookingId];
  if (alertState.attempts > 3) {
    console.log(`🚨 [OUTBOUND ALERT EXPIRED] Booking ${bookingId} alert call failed to receive keypress confirmation after 3 attempts.`);
    delete activeAlerts[bookingId];
    return;
  }

  if (bot.simulateVoice) {
    console.log(`\n======================================================`);
    console.log(`📞 [LuminaVoice OUTBOUND SIMULATION] (Attempt ${alertState.attempts}/3)`);
    console.log(`Dialing landline: ${alertState.ownerPhone}`);
    console.log(`Playing details: "Hello chef, you have a new booking from ${booking.name} for ${booking.notes}. Please press 1 to confirm this booking."`);
    console.log(`👉 To simulate keypress 1, trigger: POST http://localhost:5001/api/voice/confirm?bookingId=${bookingId}`);
    console.log(`======================================================\n`);

    const isTesting = process.env.NODE_ENV === 'test' || process.env.TESTING_VOICE === 'true';
    const retryTimeout = isTesting ? 1000 : 120000;

    setTimeout(() => {
      const current = activeAlerts[bookingId];
      if (current && !current.confirmed) {
        console.log(`⏳ [OUTBOUND ALERT RETRY] No confirmation received for booking ${bookingId} after attempt ${current.attempts}. Retrying...`);
        dispatchOutboundAlert(bot, booking);
      }
    }, retryTimeout);
  } else {
    console.log(`📞 [Twilio Outbound Alert Call Triggered] (Attempt ${alertState.attempts}/3) for booking ${bookingId}`);
  }
}

// POST /api/voice/confirm — Simulated endpoint to simulate keypress confirmation
app.post('/api/voice/confirm', (req, res) => {
  const bookingId = req.query.bookingId || req.body.bookingId;
  const alertState = activeAlerts[bookingId];
  if (!alertState) {
    return res.status(404).json({ error: 'Alert not found or already completed' });
  }

  alertState.confirmed = true;
  console.log(`✅ [OUTBOUND ALERT CONFIRMED] Booking ${bookingId} was successfully confirmed by owner!`);
  delete activeAlerts[bookingId];

  res.json({ success: true, message: "Booking confirmed, alert retry loop canceled." });
});

// POST /api/voice/outbound-alert-twiml — TwiML returned for real Twilio alert calls
app.post('/api/voice/outbound-alert-twiml', asyncHandler(async (req, res) => {
  const bookingId = req.query.bookingId || req.body.bookingId;
  const alertState = activeAlerts[bookingId];
  if (!alertState) {
    res.type('text/xml');
    return res.send(`
      <Response>
        <Say voice="Polly.Amy">Error: booking not found. Goodbye.</Say>
        <Hangup/>
      </Response>
    `);
  }

  const bots = await loadBots();
  const bot = bots[alertState.botId] || {};
  const booking = alertState.booking;
  res.type('text/xml');
  const promptText = `Hello chef. You have a new booking from ${booking.name} on ${booking.date} at ${booking.time}. Please press 1 to confirm this booking.`;
  const gatherPlay = await getVoiceResponseTwiML(promptText, bot, req);
  const noKeypressPlay = await getVoiceResponseTwiML("We did not receive a keypress. We will call you back shortly.", bot, req);
  res.send(`
    <Response>
      <Gather numDigits="1" action="/api/voice/outbound-alert-confirm?bookingId=${bookingId}" method="POST" timeout="10">
        ${gatherPlay}
      </Gather>
      ${noKeypressPlay}
    </Response>
  `);
}));

// POST /api/voice/outbound-alert-confirm — Real Twilio Call keypress receiver
app.post('/api/voice/outbound-alert-confirm', asyncHandler(async (req, res) => {
  const bookingId = req.query.bookingId || req.body.bookingId;
  const digits = req.body.Digits;
  const alertState = activeAlerts[bookingId];

  if (!alertState) {
    res.type('text/xml');
    return res.send(`<Response><Say>Error. Goodbye.</Say><Hangup/></Response>`);
  }

  const bots = await loadBots();
  const bot = bots[alertState.botId] || {};

  res.type('text/xml');
  if (digits === '1') {
    alertState.confirmed = true;
    console.log(`✅ [OUTBOUND ALERT CONFIRMED VIA KEYPRESS] Booking ${bookingId} confirmed.`);
    delete activeAlerts[bookingId];
    const confirmPlay = await getVoiceResponseTwiML("Thank you. The booking is confirmed. Goodbye.", bot, req);
    res.send(`
      <Response>
        ${confirmPlay}
        <Hangup/>
      </Response>
    `);
  } else {
    const incorrectPlay = await getVoiceResponseTwiML("Incorrect option. We will call you back shortly.", bot, req);
    res.send(`
      <Response>
        ${incorrectPlay}
        <Hangup/>
      </Response>
    `);
  }
}));

// Generate ElevenLabs Text-to-Speech audio and write to disk, using MD5 cache
async function generateElevenLabsTTS(text, bot) {
  const apiKey = (bot.elevenLabsApiKey && bot.elevenLabsApiKey.trim())
    ? bot.elevenLabsApiKey.trim()
    : 'sk_7745c909b8cc85e87df61d1f06f8091ca5c330de27e374e7';

  const voiceId = (bot.elevenLabsVoiceId && bot.elevenLabsVoiceId.trim())
    ? bot.elevenLabsVoiceId.trim()
    : 'XrExE9yKIg1WjnnlVkGX'; // Matilda default

  const textHash = crypto.createHash('md5').update(text + '_' + voiceId).digest('hex');
  const filename = `tts_${textHash}.mp3`;
  const filePath = path.join(__dirname, '..', 'temp_audio', filename);

  // Return early if file already exists in cache
  if (fs.existsSync(filePath)) {
    return `/temp_audio/${filename}`;
  }

  const payload = JSON.stringify({
    text: text,
    model_id: "eleven_turbo_v2_5",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', (chunk) => errorData += chunk);
        res.on('end', () => {
          reject(new Error(`ElevenLabs API returned status ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(filePath, buffer);
          resolve(`/temp_audio/${filename}`);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// Helper function to build TwiML voice responses, falling back to Say Polly voice if ElevenLabs fails
async function getVoiceResponseTwiML(text, bot, req, options = {}) {
  const language = options.language || 'en-US';
  const voice = options.voice || 'Polly.Amy';

  if (bot.useElevenLabs) {
    try {
      const audioPath = await generateElevenLabsTTS(text, bot);
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers.host;
      const audioUrl = `${protocol}://${host}${audioPath}`;
      return `<Play>${audioUrl}</Play>`;
    } catch (err) {
      console.error('🔴 ElevenLabs TTS generation failed, falling back to Say:', err.message);
    }
  }

  // Fallback to standard TwiML Say
  const langAttr = language !== 'en-US' ? ` language="${language}"` : '';
  return `<Say voice="${voice}"${langAttr}>${text}</Say>`;
}

// Helper function to make standard HTTPS requests for Gemini API
function makeHttpsRequest(url, options, bodyData) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
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
