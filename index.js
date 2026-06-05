document.addEventListener('DOMContentLoaded', () => {
  // DOM References - Config Panel
  const botNameInput = document.getElementById('botName');
  const botAvatarSelect = document.getElementById('botAvatar');
  const themeColorInput = document.getElementById('themeColor');
  const welcomeMsgInput = document.getElementById('welcomeMsg');
  const bookingMethodInput = document.getElementById('bookingMethod');
  const calendlyUrlGroup = document.getElementById('calendlyUrlGroup');
  const calendlyUrlInput = document.getElementById('calendlyUrl');
  
  const receiverEmailInput = document.getElementById('receiverEmail');
  const resendApiKeyInput = document.getElementById('resendApiKey');
  const senderEmailInput = document.getElementById('senderEmail');
  const openLeadsPageBtn = document.getElementById('openLeadsPageBtn');
  const ownerPortalSection = document.getElementById('ownerPortalSection');
  const copyPortalLinkBtn = document.getElementById('copyPortalLinkBtn');

  const apiKeyInput = document.getElementById('apiKey');
  const systemPromptInput = document.getElementById('systemPrompt');
  const embedCodeBox = document.getElementById('embedCode');
  
  // DOM References - Scraper Controls
  const scrapeUrlInput = document.getElementById('scrapeUrl');
  const scrapeBtn = document.getElementById('scrapeBtn');
  const scrapeStatus = document.getElementById('scrapeStatus');
  const manualDataInput = document.getElementById('manualDataInput');
  const extensionStatus = document.getElementById('extensionStatus');
  
  // DOM References - UI Control elements
  const presetDots = document.querySelectorAll('.preset-dot');
  const templateBtns = document.querySelectorAll('.template-btn');
  const sidebarCopyBtn = document.getElementById('sidebarCopyBtn');
  const topCopyBtn = document.getElementById('topCopyBtn');
  
  // DOM References - Viewport tabs and Preview mockups
  const tabSummary = document.getElementById('tabSummary');
  const tabWebsite = document.getElementById('tabWebsite');
  const browserAddress = document.getElementById('browserAddress');
  const previewIframe = document.getElementById('previewIframe');
  const siteFallback = document.getElementById('site-summary-fallback');
  const fallbackSiteName = document.getElementById('fallback-site-name');
  const fallbackSiteUrl = document.getElementById('fallback-site-url');
  const fallbackPagesList = document.getElementById('fallback-pages-list');
  const fallbackCalendar = document.getElementById('fallback-calendar');
  const fallbackKnowledgePreview = document.getElementById('fallback-knowledge-preview');

  // Track crawled pages during scraping session
  let crawledPages = [];
  let lastScrapedDataText = '';
  let lastScrapedDomain = '';

  function compileSystemPrompt() {
    const domainName = lastScrapedDomain || 'Business';
    
    // Combine base scraped text + manual supplement
    let fullTrainingData = lastScrapedDataText;
    const manualSupp = manualDataInput?.value?.trim();
    if (manualSupp) {
      fullTrainingData += `\nMANUAL SUPPLEMENT (prices, menu, extra info):\n${manualSupp}\n`;
    }

    const bookingMethodVal = bookingMethodInput.value;
    const bookingLink = bookingMethodVal === 'builtin' ? '#book-form' : (calendlyUrlInput.value.trim() || 'https://calendly.com/mock-dentist');
    
    systemPromptInput.value = `You are a helpful, professional AI assistant for ${domainName}. Your goal is to guide visitors, answer their inquiries, and assist them in scheduling appointments.

---
WEBSITE TRAINING DATA:
${fullTrainingData.substring(0, 45000)}
---

INSTRUCTIONS:
1. ADAPT YOUR PERSONA: Adopt the appropriate persona based on the website content. For example:
   - If it is a service trade (plumber, electrician, locksmith): Act as a dispatcher/assistant. Ask questions about the specific issue they need help with (e.g. leaks, wiring, emergency repairs) before guiding them to schedule a visit.
   - If it is a personal portfolio/resume: Speak warmly in the first-person (I/me/my) representing the person. Share experience, skills, and projects.
   - If it is a restaurant: Act as the restaurant host/assistant. Provide information on dishes, pricing, beers, drinks, and reserve tables.
   - If it is real estate: Act as a property advisor. Ask if they are looking to buy, rent, or sell. Answer questions about warm rent (inclusive of utilities) or cold rent if available.
2. PRICING & DATA SEARCH: Always look up the exact details (e.g., services, products, menu items, prices, service fees, rates) in the WEBSITE TRAINING DATA above and state them directly to the user. Do NOT tell them to check the menu or website if the details are already in the training data. However, to prevent Google Gemini API's strict "RECITATION" safety filter from instantly truncating the response mid-sentence (which happens when you copy text/lists/prices/names verbatim), you MUST follow these four strict rules:
   a) NEVER use raw currency symbols (€, $, £) in your responses. Instead, always translate them into words or currency codes (e.g., write "Euros", "EUR", "Dollars", "USD", "Pounds", "GBP"). For example, write "25.90 Euros" or "EUR 25.90" instead of using the symbol.
   b) NEVER use quotation marks (", ', “, ”) around any dishes, items, services, or names from the website training data. The safety filter flags quotes around names as verbatim recitation blocks.
   c) NEVER copy names of dishes, services, or menu items verbatim. Always rephrase them, write them in lowercase, and insert extra descriptors (e.g. write "the delicious beenham met asperges dish" instead of "Beenham met asperges", or "our classic tournedos steak" instead of "Tournedos").
   d) NEVER output items and prices in raw list/table structures that mimic the training data. Always present all information in natural, complete sentences.
   If a price or cost is not listed anywhere in the training data, state that rates vary and guide them to schedule a call for a custom estimate.
3. BOOKING INLINE: If the user wants to book, schedule, or reserve, you MUST guide them by outputting this exact Markdown link: [Book Appointment](${bookingLink}).
4. CONVERSATIONAL BREVITY: Keep all replies warm, helpful, and concise (under 2-3 sentences max). Always finish your thoughts and sentences completely. Never cut off or end a response in an incomplete or trailing state.
5. CLOSING TRIGGER: If the user says "thank you", "thanks", "danke", "vielen dank", "merci", or indicates they are done, reply politely and ask if you can close the chat by including this exact link: "Can we close the chat? [Yes, close chat](#close) or [Keep chatting](#keep)"..`;
  }

  function parseLoadedSystemPrompt(systemPrompt) {
    try {
      // 1. Try to extract domain
      const domainMatch = systemPrompt.match(/AI assistant for ([^.]+)\./i);
      if (domainMatch) {
        lastScrapedDomain = domainMatch[1];
      }

      // 2. Try to extract training data block
      const startTag = 'WEBSITE TRAINING DATA:\n';
      const endTag = '\n---';
      const startIndex = systemPrompt.indexOf(startTag);
      const endIndex = systemPrompt.indexOf(endTag, startIndex);
      
      if (startIndex !== -1 && endIndex !== -1) {
        let trainingBlock = systemPrompt.substring(startIndex + startTag.length, endIndex);
        
        // Remove the manual supplement part from the trainingBlock to get base scraped text
        const manualSuppHeader = '\nMANUAL SUPPLEMENT (prices, menu, extra info):\n';
        const manualIndex = trainingBlock.indexOf(manualSuppHeader);
        if (manualIndex !== -1) {
          trainingBlock = trainingBlock.substring(0, manualIndex);
        }
        
        lastScrapedDataText = trainingBlock;
      }
    } catch (e) {
      console.warn('Failed to parse loaded system prompt:', e);
    }
  }

  // Constants for preset templates
  const presets = {
    dentist: {
      name: 'Smile Assistant',
      avatar: '🦷',
      color: '#0ea5e9',
      address: 'https://www.smiledentalclinic.com',
      calendly: 'https://calendly.com/mock-dentist',
      bookingMethod: 'builtin',
      welcome: 'Hi! Welcome to Smile Dental Clinic. How can I help you book or learn about our dental cleaning rates today?',
      prompt: `You are Smile Dental Clinic's friendly receptionist. Your goal is to guide visitors to book a dental checkup.
- Cleaning costs €79. Whitening is €199.
- If asked to book/schedule, request their details using the booking tool: [Book Appointment](#book-form).
- Keep replies brief, professional, and warm.`
    },
    gym: {
      name: 'Forge Bot',
      avatar: '💪',
      color: '#ef4444',
      address: 'https://www.ironforgefitness.com',
      calendly: 'https://calendly.com/mock-gym',
      bookingMethod: 'builtin',
      welcome: 'Hey there! Ready to crush your goals at Iron Forge? Ask me about memberships or claiming a free guest pass!',
      prompt: `You are Iron Forge Gym's AI assistant. Your goal is to get visitors to sign up for a guest pass.
- Memberships are €39/month.
- Free 3-day guest pass booking link: [Claim your free pass](#book-form).
- Keep it high energy, motivating, and focus on booking their guest pass.`
    },
    realtor: {
      name: 'Apex Finder',
      avatar: '🏠',
      color: '#6366f1',
      address: 'https://www.apexrealtygroup.com',
      calendly: 'https://calendly.com/mock-realtor',
      bookingMethod: 'builtin',
      welcome: 'Welcome to Apex Realty. Looking to buy, sell, or rent a home? Ask me about listings or schedule a chat with an agent!',
      prompt: `You are Apex Realty's assistant. Your goal is to capture details about what buyers are looking for.
- Active listings: Amsterdam West €345k, Leidseplein €499k, Prinsengracht Canal Side €780k.
- Book a free agent call: [Schedule a Consultation](#book-form)
- Keep replies professional and ask clarifying questions about budget/neighborhood.`
    }
  };

  // 1. LocalStorage Persist Load
  function loadSavedConfig() {
    const saved = localStorage.getItem('luminabot_config');
    if (saved) {
      const config = JSON.parse(saved);
      botNameInput.value = config.botName || '';
      botAvatarSelect.value = config.botAvatar || '🤖';
      themeColorInput.value = config.themeColor || '#6366f1';
      welcomeMsgInput.value = config.welcomeMsg || '';
      bookingMethodInput.value = config.bookingMethod || 'builtin';
      calendlyUrlInput.value = config.calendlyUrl || 'https://calendly.com/mock-dentist';
      calendlyUrlGroup.style.display = bookingMethodInput.value === 'calendly' ? 'flex' : 'none';
      
      receiverEmailInput.value = config.receiverEmail || '';
      resendApiKeyInput.value = config.resendApiKey || '';
      senderEmailInput.value = config.senderEmail || 'onboarding@resend.dev';

      apiKeyInput.value = config.apiKey || 'DEMO';
      systemPromptInput.value = config.systemPrompt || '';
      
      // Load manualData
      manualDataInput.value = config.manualData || '';
      
      // Parse systemPrompt to recover lastScrapedDataText and lastScrapedDomain
      parseLoadedSystemPrompt(config.systemPrompt || '');
      
      // Update color preset dots state
      updatePresetDotsState(config.themeColor);
    }
  }

  // 2. LocalStorage Persist Save
  function saveCurrentConfig() {
    const config = {
      botName: botNameInput.value,
      botAvatar: botAvatarSelect.value,
      themeColor: themeColorInput.value,
      welcomeMsg: welcomeMsgInput.value,
      bookingMethod: bookingMethodInput.value,
      calendlyUrl: calendlyUrlInput.value,
      
      receiverEmail: receiverEmailInput.value,
      resendApiKey: resendApiKeyInput.value,
      senderEmail: senderEmailInput.value,

      apiKey: apiKeyInput.value,
      systemPrompt: systemPromptInput.value,
      manualData: manualDataInput.value
    };
    localStorage.setItem('luminabot_config', JSON.stringify(config));
  }

  // 3. Update active color preset dot selector
  function updatePresetDotsState(activeColor) {
    presetDots.forEach(dot => {
      if (dot.getAttribute('data-color').toLowerCase() === activeColor.toLowerCase()) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  // 4. Update the preview widget and the embed script box
  function updateWidgetPreview(resetHistory = false) {
    saveCurrentConfig();

    const config = {
      apiKey: apiKeyInput.value,
      botName: botNameInput.value,
      themeColor: themeColorInput.value,
      welcomeMsg: welcomeMsgInput.value,
      systemPrompt: systemPromptInput.value,
      botAvatar: botAvatarSelect.value,
      bookingMethod: bookingMethodInput.value,
      calendlyUrl: calendlyUrlInput.value
    };

    // Post message to the widget inside index.html window (widget.js listens to this)
    window.postMessage({
      type: 'LUMINABOT_CONFIG_UPDATE',
      config: config,
      activeBotId: activeBotId || null,
      resetHistory: resetHistory
    }, '*');

    // Update the embed script display box
    let origin = window.location.origin;
    if (!origin || origin === 'null' || origin.startsWith('file')) {
      origin = 'file://';
    }
    const scriptBaseUrl = `${origin}${window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'))}`;
    const widgetUrl = `${scriptBaseUrl}/widget.js`;

    // Escape script brackets to show properly as text inside the pre tag
    const embedText = `&lt;script 
  src="${widgetUrl}" 
  data-api-key="${config.apiKey}" 
  data-bot-name="${config.botName}" 
  data-theme-color="${config.themeColor}" 
  data-avatar="${config.botAvatar}" 
  data-booking-method="${config.bookingMethod}"
  data-calendly-url="${config.calendlyUrl}"
  data-welcome-msg="${config.welcomeMsg.replace(/"/g, '&quot;')}" 
  data-system-prompt="${config.systemPrompt.replace(/"/g, '&quot;').replace(/\n/g, ' ')}"&gt;
&lt;/script&gt;`;

    embedCodeBox.innerHTML = embedText;

    // Update training summary dashboard fields
    fallbackSiteName.textContent = config.botName;
    if (config.bookingMethod === 'builtin') {
      fallbackCalendar.textContent = 'Active (Built-in Form)';
      fallbackCalendar.style.color = '#10b981';
    } else {
      fallbackCalendar.textContent = config.calendlyUrl ? 'Connected (Calendly)' : 'Not Connected';
      fallbackCalendar.style.color = config.calendlyUrl ? '#10b981' : '#ef4444';
    }
    fallbackKnowledgePreview.value = config.systemPrompt;
  }

  // 5. Select preset template
  function applyTemplate(type) {
    const template = presets[type];
    if (!template) return;

    botNameInput.value = template.name;
    botAvatarSelect.value = template.avatar;
    themeColorInput.value = template.color;
    welcomeMsgInput.value = template.welcome;
    bookingMethodInput.value = template.bookingMethod || 'builtin';
    calendlyUrlInput.value = template.calendly;
    calendlyUrlGroup.style.display = bookingMethodInput.value === 'calendly' ? 'flex' : 'none';
    systemPromptInput.value = template.prompt;

    // Update presets UI
    updatePresetDotsState(template.color);
    
    templateBtns.forEach(btn => {
      if (btn.getAttribute('data-type') === type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Mock Browser View
    browserAddress.textContent = template.address;
    previewIframe.src = template.address;
    fallbackSiteUrl.textContent = template.address;
    
    crawledPages = [
      { url: template.address, title: 'Homepage (/)', status: 'Success' },
      { url: `${template.address}/services`, title: 'Services (/services)', status: 'Success' },
      { url: `${template.address}/about`, title: 'About Us (/about)', status: 'Success' }
    ];
    renderCrawledPagesList();

    // Repaint chatbot & reset conversation history
    updateWidgetPreview(true);
  }

  // Render list of crawled pages in the fallback view
  function renderCrawledPagesList() {
    fallbackPagesList.innerHTML = '';
    crawledPages.forEach(page => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.gap = '6px';
      li.innerHTML = `✔️ ${page.title} <span style="font-size: 9px; color: #64748b; font-family: monospace;">(${page.status})</span>`;
      fallbackPagesList.appendChild(li);
    });
  }

  // 6. Switch dynamic previews between summary, website, and leads
  function setViewTab(viewType) {
    tabSummary.classList.toggle('active', viewType === 'summary');
    tabWebsite.classList.toggle('active', viewType === 'website');
    const tabLeads = document.getElementById('tabLeads');
    if (tabLeads) tabLeads.classList.toggle('active', viewType === 'leads');

    const siteFallback = document.getElementById('site-summary-fallback');
    const siteLeadsContainer = document.getElementById('site-leads-container');

    if (siteFallback) siteFallback.style.display = viewType === 'summary' ? 'flex' : 'none';
    if (previewIframe) previewIframe.style.display = viewType === 'website' ? 'block' : 'none';
    if (siteLeadsContainer) siteLeadsContainer.style.display = viewType === 'leads' ? 'flex' : 'none';

    if (viewType === 'leads') {
      fetchAndRenderBookings();
    }
  }

  // 7. Chrome Extension helper connection & detection
  function checkExtensionStatus() {
    const hasExtension = !!document.getElementById('luminabot-extension-active');
    if (hasExtension) {
      extensionStatus.innerHTML = `🟢 <span style="color: #10b981; font-weight: 600;">Extension active</span> (CORS bypassed)`;
    } else {
      extensionStatus.innerHTML = `ℹ️ <span style="color: #f59e0b;">Standard mode</span> (CDN pages might block). <a href="extension/README.md" target="_blank" style="color: #38bdf8; text-decoration: underline;">Install helper extension</a> for best results.`;
    }
    return hasExtension;
  }

  // Check extension status on load and periodically
  setTimeout(checkExtensionStatus, 150);
  setInterval(checkExtensionStatus, 2000);

  function fetchViaExtension(url) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(2, 11);
      
      const responseListener = (event) => {
        if (event.source === window && event.data?.type === 'LUMINABOT_EXTENSION_RESPONSE' && event.data?.requestId === requestId) {
          window.removeEventListener('message', responseListener);
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve({
              html: event.data.html || null,
              pdfBase64: event.data.pdfBase64 || null
            });
          }
        }
      };

      window.addEventListener('message', responseListener);
      
      window.postMessage({
        type: 'LUMINABOT_EXTENSION_FETCH',
        requestId,
        url
      }, '*');

      // 30s timeout to allow headless background tab rendering
      setTimeout(() => {
        window.removeEventListener('message', responseListener);
        reject(new Error('Extension fetch request timed out.'));
      }, 30000);
    });
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function parsePDFText(arrayBuffer) {
    if (typeof window['pdfjs-dist/build/pdf'] === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      fullText += strings.join(' ') + '\n';
    }
    return fullText;
  }

  async function fetchPDFData(url) {
    if (checkExtensionStatus()) {
      try {
        console.log(`Attempting PDF fetch via extension helper for: ${url}`);
        const result = await fetchViaExtension(url);
        if (result && result.pdfBase64) {
          return base64ToArrayBuffer(result.pdfBase64);
        }
      } catch (err) {
        console.warn(`Extension PDF fetch failed for ${url}, falling back to server scraper:`, err);
      }
    }

    try {
      console.log(`Attempting server-side PDF fetch for: ${url}`);
      const proxyUrl = `${window.location.origin}/api/scrape?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (response.ok) {
        return await response.arrayBuffer();
      }
    } catch (err) {
      console.warn(`Server PDF fetch failed for ${url}, trying direct:`, err);
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    return await response.arrayBuffer();
  }

  async function discoverSitemapLinks(baseUrl) {
    try {
      const urlObj = new URL(baseUrl);
      const sitemapUrl = `${urlObj.origin}/sitemap.xml`;
      console.log(`Attempting to discover sitemap at: ${sitemapUrl}`);
      
      const xmlText = await fetchPageHTML(sitemapUrl);
      if (!xmlText || xmlText.trim().length < 20 || (!xmlText.includes('<url>') && !xmlText.includes('<sitemap>'))) {
        console.log('No valid sitemap content found.');
        return [];
      }
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // Check if it is a sitemap index
      const sitemaps = xmlDoc.getElementsByTagName('sitemap');
      if (sitemaps.length > 0) {
        console.log(`Sitemap index detected with ${sitemaps.length} sub-sitemaps.`);
        const subLinks = [];
        for (let i = 0; i < Math.min(sitemaps.length, 2); i++) {
          const locEl = sitemaps[i].getElementsByTagName('loc')[0];
          if (locEl) {
            const subLinksBatch = await discoverSitemapLinks(locEl.textContent.trim());
            subLinks.push(...subLinksBatch);
          }
        }
        return subLinks;
      }
      
      const locElements = xmlDoc.getElementsByTagName('loc');
      const links = [];
      
      for (let i = 0; i < locElements.length; i++) {
        try {
          const loc = locElements[i].textContent.trim();
          const locObj = new URL(loc);
          if (locObj.host === urlObj.host) {
            links.push(locObj.origin + locObj.pathname);
          }
        } catch (e) {}
      }
      
      console.log(`Discovered ${links.length} links from sitemap`);
      return links;
    } catch (err) {
      console.warn('Sitemap discovery failed:', err);
      return [];
    }
  }

  // 8. Fetch page content via robust fallback pipeline (Extension -> Direct -> CORS Proxies)
  async function fetchPageHTML(url) {
    // Try 0: Chrome Extension Scraper Helper (if installed, completely bypasses CORS and CDN blocks)
    if (checkExtensionStatus()) {
      try {
        console.log(`Attempting fetch via extension helper for: ${url}`);
        const result = await fetchViaExtension(url);
        const text = result?.html || '';
        if (text && text.trim().length > 100) {
          console.log(`Extension fetch succeeded for ${url}`);
          return text;
        }
      } catch (err) {
        console.warn(`Extension fetch failed for ${url}, falling back to server scraper:`, err);
      }
    }

    // Try 1: Server-side scrape via our own Node.js backend (bypasses CORS completely)
    try {
      console.log(`Attempting server-side scrape for: ${url}`);
      const proxyUrl = `${window.location.origin}/api/scrape?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().length > 100) {
          console.log(`Server-side scrape succeeded for ${url}`);
          return text;
        }
      }
    } catch (err) {
      console.warn(`Server-side scrape failed for ${url}, falling back to direct fetch:`, err);
    }

    // Try 2: Direct Fetch (works for CORS-enabled sites)
    try {
      console.log(`Attempting direct fetch for: ${url}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().length > 100) {
          console.log(`Direct fetch succeeded for ${url}`);
          return text;
        }
      }
    } catch (err) {
      console.warn(`Direct fetch failed for ${url}:`, err);
    }

    // Try 2: Corsproxy.io (fast, raw HTML proxy)
    try {
      console.log(`Attempting corsproxy.io fetch for: ${url}`);
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().length > 100) {
          console.log(`corsproxy.io fetch succeeded for ${url}`);
          return text;
        }
      }
    } catch (err) {
      console.warn(`corsproxy.io fetch failed for ${url}:`, err);
    }

    // Try 3: AllOrigins JSON API (fallback proxy)
    try {
      console.log(`Attempting AllOrigins fetch for: ${url}`);
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const data = await response.json();
        if (data && data.contents) {
          console.log(`AllOrigins fetch succeeded for ${url}`);
          return data.contents;
        }
      }
    } catch (err) {
      console.warn(`AllOrigins fetch failed for ${url}:`, err);
    }

    throw new Error('Website connection failed. The server might be offline, or it blocks scraper IPs.');
  }

  // 8. Extract clean text from HTML
  function cleanHTMLText(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // Strip layout code, metadata, styling, scripts, footers, sidebars, sideareas
    doc.querySelectorAll('script, style, nav, footer, header, svg, iframe, noscript, link, meta, head, .footer, #footer, .sidebar, #sidebar, .sidearea, #sidearea, .widget-area, #colophon, .colophon, .et-l--footer, .et-l--header, .site-footer, .main-footer, .page-footer, .site-header, .main-header, .page-header, .site-sidebar, .main-sidebar, .page-sidebar').forEach(el => el.remove());
    
    // Add spaces around elements to prevent text from mashing together
    doc.querySelectorAll('p, div, li, td, th, h1, h2, h3, h4, h5, h6, tr, article, section, aside, option, span, strong, em, b, i, a').forEach(el => {
      el.after(' ');
      el.before(' ');
    });
    
    let text = doc.body?.innerText || doc.body?.textContent || '';
    
    // Clean spaces
    return text
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  // 9. Clipboard copy logic
  async function copyEmbedCode(button) {
    const cleanText = embedCodeBox.innerText
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    try {
      await navigator.clipboard.writeText(cleanText);
      const originalText = button.innerHTML;
      
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copied!
      `;
      button.style.backgroundColor = '#10b981';
      
      setTimeout(() => {
        button.innerHTML = originalText;
        button.style.backgroundColor = '';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
      alert('Failed to copy to clipboard.');
    }
  }

  // --- EVENT LISTENERS ---

  // Configuration form updates
  const inputs = [botNameInput, botAvatarSelect, themeColorInput, welcomeMsgInput, calendlyUrlInput, apiKeyInput, systemPromptInput];
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      const shouldResetHistory = (input === welcomeMsgInput || input === botNameInput || input === botAvatarSelect);
      updateWidgetPreview(shouldResetHistory);
    });
  });

  if (manualDataInput) {
    manualDataInput.addEventListener('input', () => {
      compileSystemPrompt();
      updateWidgetPreview();
    });
  }

  bookingMethodInput.addEventListener('change', () => {
    calendlyUrlGroup.style.display = bookingMethodInput.value === 'calendly' ? 'flex' : 'none';
    updateWidgetPreview();
  });

  const emailInputs = [receiverEmailInput, resendApiKeyInput, senderEmailInput];
  emailInputs.forEach(input => {
    input.addEventListener('input', () => {
      saveCurrentConfig();
    });
  });

  // Preset Color selection
  presetDots.forEach(dot => {
    dot.addEventListener('click', () => {
      presetDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      themeColorInput.value = dot.getAttribute('data-color');
      updateWidgetPreview();
    });
  });

  themeColorInput.addEventListener('change', () => {
    updatePresetDotsState(themeColorInput.value);
  });

  // Template Buttons
  templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      applyTemplate(type);
      setViewTab('summary');
    });
  });

  // View tabs click handlers
  tabSummary.addEventListener('click', () => setViewTab('summary'));
  tabWebsite.addEventListener('click', () => setViewTab('website'));
  const tabLeads = document.getElementById('tabLeads');
  if (tabLeads) {
    tabLeads.addEventListener('click', () => {
      setViewTab('leads');
      const badge = document.getElementById('leadsTabBadge');
      if (badge) badge.style.display = 'none';
    });
  }

  // Copy portal link to clipboard
  if (copyPortalLinkBtn) {
    copyPortalLinkBtn.addEventListener('click', () => {
      if (!activeBotId) return;
      const portalUrl = `${window.location.origin}/leads.html?botId=${activeBotId}`;
      navigator.clipboard.writeText(portalUrl).then(() => {
        const orig = copyPortalLinkBtn.innerHTML;
        copyPortalLinkBtn.innerHTML = '✅ Copied!';
        copyPortalLinkBtn.style.color = '#34d399';
        setTimeout(() => {
          copyPortalLinkBtn.innerHTML = orig;
          copyPortalLinkBtn.style.color = '';
        }, 2000);
      }).catch(() => {
        prompt('Copy this portal link to share with your client:', portalUrl);
      });
    });
  }

  // Copy Buttons
  sidebarCopyBtn.addEventListener('click', () => copyEmbedCode(sidebarCopyBtn));
  topCopyBtn.addEventListener('click', () => copyEmbedCode(topCopyBtn));

  // --- MULTI-PAGE SCRAPER & CRAWLER ---
  scrapeBtn.addEventListener('click', async () => {
    let url = scrapeUrlInput.value.trim();
    if (!url) {
      scrapeStatus.textContent = 'Please enter a URL.';
      scrapeStatus.style.color = '#ef4444';
      return;
    }
    
    // Add protocol
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      scrapeUrlInput.value = url;
    }

    // If we have an active bot and the domain changes, reset activeBotId to create a new bot
    if (activeBotId) {
      try {
        const currentWebsite = scrapeUrlInput.getAttribute('data-original-website') || '';
        if (currentWebsite) {
          const currentDomain = new URL(currentWebsite).hostname.replace('www.', '').toLowerCase();
          const newDomain = new URL(url).hostname.replace('www.', '').toLowerCase();
          if (currentDomain !== newDomain) {
            console.log(`Domain changed from ${currentDomain} to ${newDomain}. Resetting to new bot mode.`);
            activeBotId = null;
            if (saveBotBtn) saveBotBtn.style.display = '';
            if (updateBotBtn) updateBotBtn.style.display = 'none';
            if (botIdEmbedSection) botIdEmbedSection.style.display = 'none';
            if (ownerPortalSection) ownerPortalSection.style.display = 'none';
            setBotStatus('Switched to new bot mode (domain changed). Click "Save Bot" when ready.', '#f59e0b');
          }
        }
      } catch (e) {}
    }

    scrapeBtn.disabled = true;
    scrapeStatus.textContent = 'Analyzing homepage...';
    scrapeStatus.style.color = 'var(--text-muted)';
    crawledPages = [];

    // Derive name from domain
    let domainName = 'this business';
    try {
      const hostname = new URL(url).hostname;
      domainName = hostname.replace('www.', '').split('.')[0];
      domainName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
    } catch (e) {}

    // Update UI headers
    browserAddress.textContent = url;
    previewIframe.src = url;
    fallbackSiteUrl.textContent = url;
    
    // Show summary view initially
    setViewTab('summary');

    // Immediately reset training UI elements to prevent stale layout state mismatches
    fallbackSiteName.textContent = `${domainName} Assistant`;
    fallbackPagesList.innerHTML = '<li style="color: #64748b; font-style: italic;">🔍 Crawling and analyzing pages...</li>';
    fallbackKnowledgePreview.value = 'Analyzing website and training AI... Please wait.';

    // Reset inputs to clean defaults for the new domain
    botNameInput.value = `${domainName} Assistant`;
    welcomeMsgInput.value = `Hi! Welcome to ${domainName}. How can I help you today?`;
    botAvatarSelect.value = '🤖';
    themeColorInput.value = '#6366f1';
    updatePresetDotsState('#6366f1');
    systemPromptInput.value = `You are a helpful AI assistant for ${domainName}.`;

    // Immediately update widget preview so it doesn't display stale business data
    updateWidgetPreview(true);

    try {
      // 1. Scrape Homepage & Discover Links via Sitemap
      const sitemapLinks = await discoverSitemapLinks(url);
      const internalLinks = new Set(sitemapLinks);
      
      const homeHTML = await fetchPageHTML(url);
      const homeText = cleanHTMLText(homeHTML);
      
      crawledPages.push({
        url: url,
        title: 'Homepage (/)',
        status: 'Success'
      });
      renderCrawledPagesList();

      const baseURLObj = new URL(url);
      let cleanBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;

      // If sitemap didn't yield any links, fall back to parsing anchors from homepage HTML
      if (internalLinks.size === 0) {
        console.log('No links from sitemap.xml. Falling back to homepage anchor extraction...');
        const parser = new DOMParser();
        const homeDoc = parser.parseFromString(homeHTML, 'text/html');
        const anchors = Array.from(homeDoc.querySelectorAll('a[href]'));
        
        anchors.forEach(a => {
          try {
            const href = a.getAttribute('href');
            const absoluteURL = new URL(href, url);
            
            // Verify it is on the same host and is not an excluded file format
            if (absoluteURL.host === baseURLObj.host) {
              const cleanPath = absoluteURL.pathname.toLowerCase();
              const isWpOrFeed = /(wp-json|wp-content|wp-includes|wp-admin|xmlrpc)/i.test(cleanPath) ||
                                 /(\/feed\/?$|\/feed\/)/i.test(cleanPath) ||
                                 /(\/comments\/?$|\/comments\/)/i.test(cleanPath);
                                 
              if (!/\.(zip|png|jpg|jpeg|docx|xml|css|js|webp)$/i.test(cleanPath) && 
                  !isWpOrFeed && 
                  absoluteURL.hash === '') {
                // Standardize and normalize trailing slashes to avoid duplicates
                let normalized = absoluteURL.origin + absoluteURL.pathname;
                if (normalized.endsWith('/')) {
                  normalized = normalized.slice(0, -1);
                }
                if (normalized !== cleanBaseUrl) {
                  internalLinks.add(normalized);
                }
              }
            }
          } catch (e) {}
        });
      } else {
        // Sanitize and filter discovered sitemap links (excluding non-text resources)
        const filteredSitemapLinks = Array.from(internalLinks).filter(link => {
          try {
            const absoluteURL = new URL(link);
            const cleanPath = absoluteURL.pathname.toLowerCase();
            const isWpOrFeed = /(wp-json|wp-content|wp-includes|wp-admin|xmlrpc)/i.test(cleanPath) ||
                               /(\/feed\/?$|\/feed\/)/i.test(cleanPath) ||
                               /(\/comments\/?$|\/comments\/)/i.test(cleanPath);
            return !/\.(zip|png|jpg|jpeg|docx|xml|css|js|webp)$/i.test(cleanPath) && 
                   !isWpOrFeed && 
                   absoluteURL.hash === '' &&
                   (absoluteURL.origin + absoluteURL.pathname) !== cleanBaseUrl;
          } catch(e) {
            return false;
          }
        });
        internalLinks.clear();
        filteredSitemapLinks.forEach(link => internalLinks.add(link));
      }

      // Rank links to prioritize critical pages (services, pricing, menus, listings, portfolio, contact) across both English and German
      const rankedLinks = Array.from(internalLinks).map(link => {
        const linkPath = link.toLowerCase();
        let weight = 0;
        
        // Menus / Food & Drinks (Restaurants)
        if (linkPath.includes('menu') || linkPath.includes('speisen') || linkPath.includes('getraenke') || linkPath.includes('karte') || linkPath.includes('card') || linkPath.includes('dishes') || linkPath.includes('beer') || linkPath.includes('wine') || linkPath.includes('drink') || linkPath.includes('biere') || linkPath.includes('food') || linkPath.includes('essen')) {
          weight += 15;
        }
        
        // Services, Pricing & Rates (Plumbers, Electricians, Dentists, General Services, Salons)
        if (linkPath.includes('service') || linkPath.includes('rates') || linkPath.includes('offer') || linkPath.includes('leistung') || linkPath.includes('preis') || linkPath.includes('cost') || linkPath.includes('charge') || linkPath.includes('rate') || linkPath.includes('price') || linkPath.includes('pricing') || linkPath.includes('tarife') || linkPath.includes('tariff') || linkPath.includes('fees') || linkPath.includes('gebuehr') || linkPath.includes('treatment') || linkPath.includes('haircut') || linkPath.includes('color') || linkPath.includes('style')) {
          weight += 15;
        }
        
        // Booking & Reservation pages
        if (linkPath.includes('book') || linkPath.includes('reserve') || linkPath.includes('reservation') || linkPath.includes('appointment') || linkPath.includes('termin') || linkPath.includes('buchung') || linkPath.includes('booking')) {
          weight += 12;
        }
        
        // Contact & Location
        if (linkPath.includes('contact') || linkPath.includes('location') || linkPath.includes('reach') || linkPath.includes('kontakt') || linkPath.includes('anfahrt')) {
          weight += 10;
        }
        
        // Real Estate & Listings
        if (linkPath.includes('buy') || linkPath.includes('sell') || linkPath.includes('rent') || linkPath.includes('mieten') || linkPath.includes('kaufen') || linkPath.includes('wohnung') || linkPath.includes('haus') || linkPath.includes('flat') || linkPath.includes('apartment') || linkPath.includes('listing') || linkPath.includes('immobilien')) {
          weight += 9;
        }
        
        // Portfolios & Work Examples
        if (linkPath.includes('portfolio') || linkPath.includes('work') || linkPath.includes('project') || linkPath.includes('gallery') || linkPath.includes('projekte') || linkPath.includes('referenz')) {
          weight += 8;
        }
        
        // About, FAQ & Info
        if (linkPath.includes('about') || linkPath.includes('story') || linkPath.includes('team') || linkPath.includes('faq') || linkPath.includes('help') || linkPath.includes('info') || linkPath.includes('ueber')) {
          weight += 6;
        }
        
        return { link, weight };
      });

      // Sort links by weight descending, pick top 15 to scrape all relevant pages
      rankedLinks.sort((a, b) => b.weight - a.weight);
      const topLinks = rankedLinks.slice(0, 15).map(item => item.link);

      let trainingDataText = `Homepage:\n${homeText.substring(0, 6000)}\n\n`;

      // 2. Scrape internal subpages concurrently in batches of 4
      const concurrency = 4;
      const scrapedTexts = new Array(topLinks.length);
      
      for (let i = 0; i < topLinks.length; i += concurrency) {
        const batch = topLinks.slice(i, i + concurrency);
        scrapeStatus.textContent = `Scraping: Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(topLinks.length / concurrency)}...`;
        
        await Promise.all(batch.map(async (subUrl, idx) => {
          const overallIndex = i + idx;
          let pathName = subUrl;
          try {
            pathName = new URL(subUrl).pathname;
          } catch (e) {}
          
          try {
            let subText = '';
            if (subUrl.toLowerCase().endsWith('.pdf')) {
              console.log(`Scraping PDF: ${subUrl}`);
              const arrayBuffer = await fetchPDFData(subUrl);
              subText = await parsePDFText(arrayBuffer);
            } else {
              const subHTML = await fetchPageHTML(subUrl);
              subText = cleanHTMLText(subHTML);
            }
            
            crawledPages.push({
              url: subUrl,
              title: `${pathName}`,
              status: 'Success'
            });
            
            scrapedTexts[overallIndex] = `Page: ${pathName}\n${subText.substring(0, 5000)}\n\n`;
          } catch (e) {
            console.warn(`Failed to crawl subpage ${subUrl}:`, e);
            crawledPages.push({
              url: subUrl,
              title: `${pathName}`,
              status: 'Failed'
            });
          }
        }));
        
        renderCrawledPagesList();
        // brief pause to let browser main thread yield
        await new Promise(r => setTimeout(r, 100));
      }

      // Combine scraped page contents preserving priority order
      for (let i = 0; i < scrapedTexts.length; i++) {
        if (scrapedTexts[i]) {
          trainingDataText += scrapedTexts[i];
        }
      }

      // Cache base scraped text and domain so manual data updates can rebuild in real-time without re-scraping
      lastScrapedDataText = trainingDataText;
      lastScrapedDomain = domainName;

      // Compile the system instruction prompt
      compileSystemPrompt();

      // Update inputs with smart defaults based on scraped content
      botNameInput.value = `${domainName} Assistant`;
      welcomeMsgInput.value = `Hi! Welcome to ${domainName}. How can I help you today?`;

      // Autoguess the best avatar emoji based on content keywords
      const lowerText = (domainName + ' ' + trainingDataText).toLowerCase();
      let guessedAvatar = '👩‍💼'; // default friendly receptionist
      
      if (lowerText.includes('dentist') || lowerText.includes('dental') || lowerText.includes('teeth') || lowerText.includes('tooth') || lowerText.includes('smile')) {
        guessedAvatar = '🦷';
      } else if (lowerText.includes('gym') || lowerText.includes('fitness') || lowerText.includes('trainer') || lowerText.includes('workout') || lowerText.includes('body')) {
        guessedAvatar = '💪';
      } else if (lowerText.includes('realtor') || lowerText.includes('estate') || lowerText.includes('property') || lowerText.includes('house') || lowerText.includes('listings')) {
        guessedAvatar = '🏠';
      } else if (lowerText.includes('burger') || lowerText.includes('food') || lowerText.includes('restaurant') || lowerText.includes('menu') || lowerText.includes('pizza') || lowerText.includes('cafe') || lowerText.includes('diner') || lowerText.includes('snack')) {
        guessedAvatar = '🍔';
      } else if (lowerText.includes('salon') || lowerText.includes('hair') || lowerText.includes('cut') || lowerText.includes('scissors') || lowerText.includes('barber') || lowerText.includes('spa')) {
        guessedAvatar = '💇';
      } else if (lowerText.includes('shop') || lowerText.includes('store') || lowerText.includes('buy') || lowerText.includes('sell') || lowerText.includes('bag') || lowerText.includes('wear')) {
        guessedAvatar = '🛍️';
      }
      botAvatarSelect.value = guessedAvatar;

      // Autoguess matching theme color
      let guessedColor = '#6366f1'; // default indigo
      if (guessedAvatar === '🦷') guessedColor = '#0ea5e9'; // sky blue
      if (guessedAvatar === '💪') guessedColor = '#ef4444'; // red
      if (guessedAvatar === '🏠') guessedColor = '#6366f1'; // indigo
      if (guessedAvatar === '🍔') guessedColor = '#f59e0b'; // amber/orange
      if (guessedAvatar === '🛍️' || guessedAvatar === '💇') guessedColor = '#ec4899'; // pink
      
      themeColorInput.value = guessedColor;
      updatePresetDotsState(guessedColor);
      
      scrapeStatus.textContent = `Success! Trained on ${crawledPages.filter(p => p.status === 'Success').length} pages.`;
      scrapeStatus.style.color = '#10b981';

      // Update widget state & clear preview history
      updateWidgetPreview(true);

    } catch (err) {
      console.error('Crawler failed:', err);
      scrapeStatus.textContent = `Crawling failed: ${err.message || 'Check URL.'}`;
      scrapeStatus.style.color = '#ef4444';

      // Update mockup layout to indicate training failure
      fallbackSiteName.textContent = `${domainName} (Fallback)`;
      fallbackPagesList.innerHTML = `
        <li style="color: #ef4444; font-weight: 600; display: flex; align-items: center; gap: 4px;">
          ❌ Scrape Blocked (CORS/CDN)
        </li>
        <li style="color: #64748b; font-size: 11px; margin-top: 4px; line-height: 1.4; list-style-type: none;">
          This website blocks automated crawlers or requires client-side JavaScript to render.
        </li>
      `;

      const calendlyUrlVal = calendlyUrlInput.value.trim() || 'https://calendly.com/mock-dentist';
      
      // Update system prompt to a generic fallback for the new domain
      systemPromptInput.value = `You are a helpful AI assistant for ${domainName}. Answer customer inquiries politely.
      
If the user wants to book an appointment or schedule a call, guide them to click the booking button: [Book Appointment](${calendlyUrlVal}).`;

      fallbackKnowledgePreview.value = `[TRAINING FAILED: WEBSITE REACHABILITY]

The website was unreachable or blocked the automated crawler.

To configure your chatbot:
1. Manually copy-paste the client's business text/content here.
2. Edit the "System Instructions" in the configuration panel on the left.
3. Test your chatbot in the preview widget.`;

      // Reset configs to safe defaults for the new domain
      botNameInput.value = `${domainName} Assistant`;
      welcomeMsgInput.value = `Hi! Welcome to ${domainName}. How can I help you today?`;
      botAvatarSelect.value = '🤖';
      themeColorInput.value = '#6366f1';
      updatePresetDotsState('#6366f1');

      // Update widget preview with the safe fallback state
      updateWidgetPreview(true);
    } finally {
      scrapeBtn.disabled = false;
    }
  });

  // --- INITIALIZATION ---
  loadSavedConfig();
  // Ensure widget.js gets loaded and has values first
  setTimeout(() => {
    // If no local storage configurations exist, apply Dentist template as fallback
    if (!localStorage.getItem('luminabot_config')) {
      applyTemplate('dentist');
    } else {
      updateWidgetPreview(false);
    }
  }, 120);

  // ── BOT MANAGEMENT SYSTEM ─────────────────────────────────────────────────

  const API_BASE = window.location.origin; // http://localhost:5001
  let activeBotId = null; // null = new bot, string = editing existing

  // DOM refs for bot management
  const saveBotBtn = document.getElementById('saveBotBtn');
  const updateBotBtn = document.getElementById('updateBotBtn');
  const saveBotStatus = document.getElementById('saveBotStatus');
  const botIdEmbedSection = document.getElementById('botIdEmbedSection');
  const botIdEmbedCode = document.getElementById('botIdEmbedCode');
  const copyBotIdEmbedBtn = document.getElementById('copyBotIdEmbedBtn');
  const myBotsBtn = document.getElementById('myBotsBtn');
  const myBotsModal = document.getElementById('myBotsModal');
  const closeMyBotsModal = document.getElementById('closeMyBotsModal');
  const myBotsList = document.getElementById('myBotsList');
  const botsCount = document.getElementById('botsCount');
  const botsBadge = document.getElementById('botsBadge');
  const newBotBtn = document.getElementById('newBotBtn');

  // Show status message in the Save section
  function setBotStatus(msg, color = 'var(--text-muted)') {
    if (saveBotStatus) {
      saveBotStatus.textContent = msg;
      saveBotStatus.style.color = color;
    }
  }

  // Show bot ID embed section after saving
  function showBotIdEmbed(botId) {
    if (!botIdEmbedSection || !botIdEmbedCode) return;
    const scriptUrl = `${API_BASE}/widget.js`;
    const embed = `&lt;script src="${scriptUrl}" data-bot-id="${botId}"&gt;&lt;/script&gt;`;
    botIdEmbedCode.innerHTML = embed;
    botIdEmbedSection.style.display = 'block';
  }

  // Update the bot count badge on "My Bots" button
  async function updateBotsBadge() {
    try {
      const res = await fetch(`${API_BASE}/api/bots`);
      const data = await res.json();
      const count = data.total || 0;
      if (botsBadge) {
        botsBadge.textContent = count;
        botsBadge.style.display = count > 0 ? 'flex' : 'none';
      }
      if (botsCount) botsCount.textContent = `${count} bot${count !== 1 ? 's' : ''} saved`;
      return data.bots || [];
    } catch (e) {
      console.warn('Failed to fetch bots:', e);
      return [];
    }
  }

  // Gather current form data into a bot object
  function collectFormData() {
    return {
      name: botNameInput.value.trim() || 'Unnamed Bot',
      avatar: botAvatarSelect.value || '🤖',
      color: themeColorInput.value || '#6366f1',
      welcomeMsg: welcomeMsgInput.value.trim(),
      systemPrompt: systemPromptInput.value.trim(),
      apiKey: apiKeyInput.value.trim() || 'DEMO',
      bookingMethod: bookingMethodInput.value,
      calendlyUrl: calendlyUrlInput.value.trim(),
      website: scrapeUrlInput.value.trim(),
      manualData: manualDataInput.value.trim(),
      emailConfig: {
        receiverEmail: receiverEmailInput.value.trim(),
        resendApiKey: resendApiKeyInput.value.trim(),
        senderEmail: senderEmailInput.value.trim()
      }
    };
  }

  // Populate form from a bot object
  function loadBotIntoForm(bot) {
    activeBotId = bot.id;
    botNameInput.value = bot.name || '';
    botAvatarSelect.value = bot.avatar || '🤖';
    themeColorInput.value = bot.color || '#6366f1';
    welcomeMsgInput.value = bot.welcomeMsg || '';
    systemPromptInput.value = bot.systemPrompt || '';
    apiKeyInput.value = bot.apiKey || 'DEMO';
    bookingMethodInput.value = bot.bookingMethod || 'builtin';
    calendlyUrlInput.value = bot.calendlyUrl || '';
    calendlyUrlGroup.style.display = bookingMethodInput.value === 'calendly' ? 'flex' : 'none';
    
    const emailConfig = bot.emailConfig || {};
    receiverEmailInput.value = emailConfig.receiverEmail || '';
    resendApiKeyInput.value = emailConfig.resendApiKey || '';
    senderEmailInput.value = emailConfig.senderEmail || 'onboarding@resend.dev';

    scrapeUrlInput.value = bot.website || '';
    scrapeUrlInput.setAttribute('data-original-website', bot.website || '');
    updatePresetDotsState(bot.color || '#6366f1');
    
    // Load manualData
    manualDataInput.value = bot.manualData || '';
    
    // Parse systemPrompt to recover lastScrapedDataText and lastScrapedDomain
    parseLoadedSystemPrompt(bot.systemPrompt || '');

    updateWidgetPreview(false);
    
    if (activeBotId) {
      openLeadsPageBtn.href = `${window.location.origin}/leads.html?botId=${activeBotId}`;
      if (ownerPortalSection) ownerPortalSection.style.display = 'block';
    } else {
      if (ownerPortalSection) ownerPortalSection.style.display = 'none';
    }

    // Refresh leads table if we are currently viewing it
    const tabLeads = document.getElementById('tabLeads');
    if (tabLeads && tabLeads.classList.contains('active')) {
      fetchAndRenderBookings();
    }
  }

  // SAVE NEW BOT
  if (saveBotBtn) {
    saveBotBtn.addEventListener('click', async () => {
      saveBotBtn.disabled = true;
      setBotStatus('Saving bot...');
      try {
        const res = await fetch(`${API_BASE}/api/bots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectFormData())
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        activeBotId = data.id;
        scrapeUrlInput.setAttribute('data-original-website', collectFormData().website);
        setBotStatus(`✅ Bot saved! ID: ${data.id}`, '#10b981');
        showBotIdEmbed(data.id);
        
        openLeadsPageBtn.href = `${window.location.origin}/leads.html?botId=${activeBotId}`;
        if (ownerPortalSection) ownerPortalSection.style.display = 'block';

        // ⬇️ Critical: push the new botId into the live widget so bookings go to the server
        updateWidgetPreview(false);

        // Switch to "Update" mode
        if (saveBotBtn) saveBotBtn.style.display = 'none';
        if (updateBotBtn) updateBotBtn.style.display = '';
        await updateBotsBadge();
      } catch (e) {
        setBotStatus(`❌ Save failed: ${e.message}`, '#ef4444');
      } finally {
        saveBotBtn.disabled = false;
      }
    });
  }

  // UPDATE EXISTING BOT
  if (updateBotBtn) {
    updateBotBtn.addEventListener('click', async () => {
      if (!activeBotId) return;
      updateBotBtn.disabled = true;
      setBotStatus('Updating bot...');
      try {
        const res = await fetch(`${API_BASE}/api/bots/${activeBotId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectFormData())
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        scrapeUrlInput.setAttribute('data-original-website', collectFormData().website);
        setBotStatus(`✅ Bot updated! All sites refreshed automatically.`, '#10b981');
        showBotIdEmbed(activeBotId);
        
        openLeadsPageBtn.href = `${window.location.origin}/leads.html?botId=${activeBotId}`;
        if (ownerPortalSection) ownerPortalSection.style.display = 'block';

        // ⬇️ Refresh widget so any form submissions still go to the server
        updateWidgetPreview(false);

        await updateBotsBadge();
      } catch (e) {
        setBotStatus(`❌ Update failed: ${e.message}`, '#ef4444');
      } finally {
        updateBotBtn.disabled = false;
      }
    });
  }

  // COPY SHORT BOT-ID EMBED
  if (copyBotIdEmbedBtn) {
    copyBotIdEmbedBtn.addEventListener('click', async () => {
      const raw = botIdEmbedCode.innerHTML
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      try {
        await navigator.clipboard.writeText(raw);
        const orig = copyBotIdEmbedBtn.innerHTML;
        copyBotIdEmbedBtn.innerHTML = '✅ Copied!';
        copyBotIdEmbedBtn.style.background = '#10b981';
        setTimeout(() => { copyBotIdEmbedBtn.innerHTML = orig; copyBotIdEmbedBtn.style.background = ''; }, 2000);
      } catch (e) { alert('Copy failed'); }
    });
  }

  // MY BOTS DASHBOARD — render bot cards
  function renderBotCard(bot) {
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px 16px; display:flex; align-items:center; gap:14px;';
    card.innerHTML = `
      <div style="width:40px; height:40px; border-radius:10px; background:${bot.color || '#6366f1'}22; border:1px solid ${bot.color || '#6366f1'}44; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">${bot.avatar || '🤖'}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; font-size:13px; color:#f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${bot.name}</div>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">${bot.website || 'No website'} &bull; <span style="color:#94a3b8; font-family:monospace;">${bot.id}</span></div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <button data-action="edit" data-id="${bot.id}" style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#a5b4fc; border-radius:6px; padding:5px 10px; font-size:11px; cursor:pointer;">✏️ Edit</button>
        <button data-action="copy" data-id="${bot.id}" style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.25); color:#6ee7b7; border-radius:6px; padding:5px 10px; font-size:11px; cursor:pointer;">📋 Embed</button>
        <button data-action="delete" data-id="${bot.id}" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:#fca5a5; border-radius:6px; padding:5px 10px; font-size:11px; cursor:pointer;">🗑️</button>
      </div>
    `;
    return card;
  }

  async function openMyBots() {
    myBotsModal.style.display = 'flex';
    myBotsList.innerHTML = '<div style="text-align:center;color:#64748b;padding:40px;font-size:13px;">Loading...</div>';
    const bots = await updateBotsBadge();
    myBotsList.innerHTML = '';
    if (bots.length === 0) {
      myBotsList.innerHTML = '<div style="text-align:center;color:#64748b;padding:40px;font-size:13px;">No bots saved yet. Configure a chatbot and click "Save Bot" to get started.</div>';
      return;
    }
    bots.forEach(bot => {
      const card = renderBotCard(bot);
      myBotsList.appendChild(card);
    });

    // Handle card button clicks
    myBotsList.onclick = async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;

      if (action === 'edit') {
        // Load this bot into the form
        try {
          const res = await fetch(`${API_BASE}/api/bots/${id}`);
          const bot = await res.json();
          loadBotIntoForm(bot);
          activeBotId = id;
          if (saveBotBtn) saveBotBtn.style.display = 'none';
          if (updateBotBtn) updateBotBtn.style.display = '';
          showBotIdEmbed(id);
          setBotStatus(`📝 Editing bot: ${bot.name}`, '#a5b4fc');
          myBotsModal.style.display = 'none';
        } catch (err) { alert('Failed to load bot'); }
      }

      if (action === 'copy') {
        const scriptUrl = `${API_BASE}/widget.js`;
        const embed = `<script src="${scriptUrl}" data-bot-id="${id}"><\/script>`;
        try {
          await navigator.clipboard.writeText(embed);
          btn.textContent = '✅ Copied!';
          setTimeout(() => { btn.textContent = '📋 Embed'; }, 2000);
        } catch (e) { alert('Copy failed'); }
      }

      if (action === 'delete') {
        if (!confirm(`Delete this bot (${id})? This cannot be undone.`)) return;
        try {
          await fetch(`${API_BASE}/api/bots/${id}`, { method: 'DELETE' });
          if (activeBotId === id) {
            activeBotId = null;
            if (saveBotBtn) saveBotBtn.style.display = '';
            if (updateBotBtn) updateBotBtn.style.display = 'none';
            if (botIdEmbedSection) botIdEmbedSection.style.display = 'none';
      if (ownerPortalSection) ownerPortalSection.style.display = 'none';
            setBotStatus('');
          }
          await openMyBots(); // Refresh list
        } catch (err) { alert('Delete failed'); }
      }
    };
  }

  if (myBotsBtn) myBotsBtn.addEventListener('click', openMyBots);
  if (closeMyBotsModal) closeMyBotsModal.addEventListener('click', () => { myBotsModal.style.display = 'none'; });
  if (myBotsModal) myBotsModal.addEventListener('click', (e) => { if (e.target === myBotsModal) myBotsModal.style.display = 'none'; });

  // NEW BOT — clear form and reset to new bot mode
  if (newBotBtn) {
    newBotBtn.addEventListener('click', () => {
      activeBotId = null;
      scrapeUrlInput.setAttribute('data-original-website', '');
      if (saveBotBtn) saveBotBtn.style.display = '';
      if (updateBotBtn) updateBotBtn.style.display = 'none';
      if (botIdEmbedSection) botIdEmbedSection.style.display = 'none';
      openLeadsPageBtn.style.display = 'none';
      setBotStatus('');
      applyTemplate('dentist');
      myBotsModal.style.display = 'none';
    });
  }

  // Initialize badge on load
  updateBotsBadge();

  // ── Captured Leads Logic ───────────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }

  async function fetchAndRenderBookings() {
    const leadsTableBody = document.getElementById('leadsTableBody');
    const leadsEmptyState = document.getElementById('leadsEmptyState');
    if (!leadsTableBody) return;

    leadsTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#64748b;">Loading leads...</td></tr>';
    if (leadsEmptyState) leadsEmptyState.style.display = 'none';

    let bookingsList = [];

    if (activeBotId) {
      try {
        const res = await fetch(`${API_BASE}/api/bots/${activeBotId}/bookings`);
        if (res.ok) {
          const data = await res.json();
          bookingsList = data.bookings || [];
        }
      } catch (err) {
        console.error('Failed to fetch bookings:', err);
      }
    } else {
      const saved = localStorage.getItem('luminabot_demo_bookings');
      if (saved) {
        bookingsList = JSON.parse(saved);
      }
    }

    leadsTableBody.innerHTML = '';

    if (bookingsList.length === 0) {
      if (leadsEmptyState) leadsEmptyState.style.display = 'flex';
      return;
    }

    if (leadsEmptyState) leadsEmptyState.style.display = 'none';
    bookingsList.forEach(booking => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 12px 16px; font-weight: 600; color: #0f172a; font-family: var(--font-display);">${escapeHTML(booking.name)}</td>
        <td style="padding: 12px 16px; font-family: var(--font-sans); color: #475569;">${escapeHTML(booking.contact)}</td>
        <td style="padding: 12px 16px;">
          <span style="background: #e0e7ff; color: #4338ca; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; font-family: var(--font-sans);">${escapeHTML(booking.date)}</span>
          <span style="background: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; font-family: var(--font-sans); margin-left: 4px;">${escapeHTML(booking.time)}</span>
        </td>
        <td style="padding: 12px 16px; font-family: var(--font-sans); color: #475569; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(booking.notes)}">${escapeHTML(booking.notes) || '<span style="color:#94a3b8; font-style:italic;">None</span>'}</td>
        <td style="padding: 12px 16px; text-align: center;">
          <button class="lead-delete-btn" data-booking-id="${booking.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            Delete
          </button>
        </td>
      `;
      leadsTableBody.appendChild(tr);
    });

    leadsTableBody.querySelectorAll('.lead-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bookingId = btn.getAttribute('data-booking-id');
        if (confirm('Delete this lead?')) {
          if (activeBotId) {
            try {
              const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, { method: 'DELETE' });
              if (res.ok) fetchAndRenderBookings();
            } catch (err) { alert('Delete failed'); }
          } else {
            let demo = JSON.parse(localStorage.getItem('luminabot_demo_bookings') || '[]');
            demo = demo.filter(b => b.id !== bookingId);
            localStorage.setItem('luminabot_demo_bookings', JSON.stringify(demo));
            fetchAndRenderBookings();
          }
        }
      });
    });
  }

  // Clear All Leads
  const clearLeadsBtn = document.getElementById('clearLeadsBtn');
  if (clearLeadsBtn) {
    clearLeadsBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear ALL leads for this bot? This cannot be undone.')) return;
      if (activeBotId) {
        try {
          const res = await fetch(`${API_BASE}/api/bots/${activeBotId}/bookings`, { method: 'DELETE' });
          if (res.ok) fetchAndRenderBookings();
        } catch (e) { alert('Clear failed'); }
      } else {
        localStorage.removeItem('luminabot_demo_bookings');
        fetchAndRenderBookings();
      }
    });
  }

  // Event syncing listener — widget fires this when a booking is submitted
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'LUMINABOT_LEAD_SUBMITTED') {
      console.log('Lead submitted by preview widget, updating dashboard...');
      
      const tabLeads = document.getElementById('tabLeads');
      if (tabLeads && tabLeads.classList.contains('active')) {
        // Tab is open → refresh immediately
        fetchAndRenderBookings();
      } else if (tabLeads) {
        // Tab is closed → show a red notification dot
        let badge = document.getElementById('leadsTabBadge');
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'leadsTabBadge';
          badge.style.cssText = 'display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-left:6px; vertical-align:middle; animation: pulse 1s infinite;';
          tabLeads.appendChild(badge);
        }
        badge.style.display = 'inline-block';
      }
    }
  });

  // Auto-poll the leads table every 5s while the "Captured Leads" tab is active
  setInterval(() => {
    const tabLeads = document.getElementById('tabLeads');
    if (tabLeads && tabLeads.classList.contains('active') && activeBotId) {
      fetchAndRenderBookings();
    }
  }, 5000);

  updateWidgetPreview();
});


