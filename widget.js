(function () {
  // 1. Get configuration — supports both Bot ID (central management) and inline data-* attributes
  const scriptEl = document.currentScript || document.querySelector('script[src*="widget.js"]');

  const botId = scriptEl?.getAttribute('data-bot-id') || null;

  // Determine the API base URL from the script src (so it works on any host)
  function getApiBase() {
    const src = scriptEl?.getAttribute('src') || '';
    try {
      const url = new URL(src, window.location.href);
      return url.origin; // e.g. http://localhost:5001 or https://cdn.luminabot.com
    } catch (e) {
      return window.location.origin;
    }
  }

  // Build config from inline attributes (used as default / fallback)
  function buildInlineConfig() {
    return {
      apiKey: scriptEl?.getAttribute('data-api-key') || '',
      botName: scriptEl?.getAttribute('data-bot-name') || 'AI Assistant',
      themeColor: scriptEl?.getAttribute('data-theme-color') || '#6366f1',
      welcomeMsg: scriptEl?.getAttribute('data-welcome-msg') || 'Hi! How can I help you today?',
      systemPrompt: scriptEl?.getAttribute('data-system-prompt') || 'You are a helpful assistant.',
      placeholder: scriptEl?.getAttribute('data-placeholder') || 'Ask me anything...',
      botAvatar: scriptEl?.getAttribute('data-avatar') || '🤖',
      bookingMethod: scriptEl?.getAttribute('data-booking-method') || 'builtin',
      calendlyUrl: scriptEl?.getAttribute('data-calendly-url') || ''
    };
  }

  // Map API bot object fields to the internal config shape
  function mapBotToConfig(bot) {
    return {
      apiKey: bot.apiKey || 'DEMO',
      botName: bot.name || 'AI Assistant',
      themeColor: bot.color || '#6366f1',
      welcomeMsg: bot.welcomeMsg || 'Hi! How can I help you today?',
      systemPrompt: bot.systemPrompt || 'You are a helpful assistant.',
      placeholder: 'Ask me anything...',
      botAvatar: bot.avatar || '🤖',
      bookingMethod: bot.bookingMethod || 'builtin',
      calendlyUrl: bot.calendlyUrl || ''
    };
  }

  // Main init: fetch from API if bot-id present, otherwise use inline config
  async function resolveConfig() {
    if (botId) {
      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/api/bots/${botId}`);
        if (!res.ok) throw new Error(`Bot not found: ${botId}`);
        const bot = await res.json();
        return mapBotToConfig(bot);
      } catch (e) {
        console.warn(`[LuminaBot] Failed to load bot config for "${botId}":`, e.message);
        console.warn('[LuminaBot] Falling back to inline attributes');
      }
    }
    return buildInlineConfig();
  }

  // Defer initialization until config is resolved
  resolveConfig().then(config => initWidget(config));

  function initWidget(config) {

  // 2. Inject Stylesheet
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .luminabot-widget-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    
    /* Chat Bubble Trigger */
    .luminabot-bubble {
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background-color: ${config.themeColor};
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform: scale(1);
    }
    .luminabot-bubble:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
    }
    .luminabot-bubble svg {
      width: 28px;
      height: 28px;
      fill: white;
      transition: transform 0.3s ease;
    }
    .luminabot-bubble.active svg {
      transform: rotate(90deg) scale(0.8);
    }

    /* Chat Panel */
    .luminabot-panel {
      position: absolute;
      bottom: 76px;
      right: 0;
      width: 360px;
      height: 520px;
      border-radius: 16px;
      background-color: #0f172a; /* Slate 900 */
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .luminabot-panel.active {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* Header */
    .luminabot-header {
      background-color: #1e293b; /* Slate 800 */
      padding: 16px;
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .luminabot-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .luminabot-header-avatar {
      font-size: 24px;
      width: 36px;
      height: 36px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .luminabot-header-title {
      font-weight: 600;
      font-size: 15px;
    }
    .luminabot-header-status {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .luminabot-header-status::before {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #10b981;
    }
    .luminabot-close-btn {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .luminabot-close-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: white;
    }

    /* Message Area */
    .luminabot-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: radial-gradient(circle at top left, #1e293b, #0f172a);
    }
    
    .luminabot-messages::-webkit-scrollbar {
      width: 5px;
    }
    .luminabot-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .luminabot-messages::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    .luminabot-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .luminabot-msg-user {
      align-self: flex-end;
      background-color: ${config.themeColor};
      color: white;
      border-bottom-right-radius: 2px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .luminabot-msg-bot {
      align-self: flex-start;
      background-color: #334155; /* Slate 700 */
      color: #f1f5f9;
      border-bottom-left-radius: 2px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    /* Typing Indicator */
    .luminabot-typing {
      align-self: flex-start;
      background-color: #334155;
      padding: 12px 16px;
      border-radius: 12px;
      border-bottom-left-radius: 2px;
      display: none;
      gap: 4px;
    }
    .luminabot-typing span {
      width: 6px;
      height: 6px;
      background-color: #94a3b8;
      border-radius: 50%;
      display: inline-block;
      animation: luminabot-bounce 1.4s infinite both;
    }
    .luminabot-typing span:nth-child(2) { animation-delay: 0.2s; }
    .luminabot-typing span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes luminabot-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* Input Footer */
    .luminabot-footer {
      padding: 12px 16px;
      background-color: #1e293b;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .luminabot-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .luminabot-input {
      flex: 1;
      background-color: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 10px 12px;
      color: white;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .luminabot-input:focus {
      border-color: ${config.themeColor};
    }
    .luminabot-send-btn {
      background-color: ${config.themeColor};
      border: none;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: white;
      transition: opacity 0.2s, transform 0.1s;
    }
    .luminabot-send-btn:hover {
      opacity: 0.9;
    }
    .luminabot-send-btn:active {
      transform: scale(0.95);
    }
    .luminabot-send-btn svg {
      width: 16px;
      height: 16px;
      fill: white;
    }

    .luminabot-branding {
      font-size: 9px;
      color: #64748b;
      text-align: center;
      margin-top: 2px;
    }
    .luminabot-branding a {
      color: #64748b;
      text-decoration: none;
      font-weight: 500;
    }
    .luminabot-branding a:hover {
      color: #94a3b8;
    }
    
    /* Inline Booking Form Card */
    .luminabot-booking-card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 14px;
      margin-top: 8px;
      width: 100%;
      max-width: 290px;
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      box-sizing: border-box;
      animation: luminabot-slide-in 0.3s ease-out;
    }

    @keyframes luminabot-slide-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .luminabot-booking-card h4 {
      font-size: 13px;
      font-weight: 700;
      color: white;
      margin: 0;
      font-family: inherit;
    }

    .luminabot-booking-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .luminabot-booking-field label {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .luminabot-booking-field input,
    .luminabot-booking-field textarea {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 6px 8px;
      color: white;
      font-size: 12px;
      outline: none;
      font-family: inherit;
    }

    .luminabot-booking-field input:focus,
    .luminabot-booking-field textarea:focus {
      border-color: ${config.themeColor};
    }

    .luminabot-booking-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .luminabot-booking-submit {
      background-color: ${config.themeColor};
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .luminabot-booking-submit:hover {
      opacity: 0.9;
    }

    .luminabot-booking-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .luminabot-booking-success {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px 0;
      gap: 6px;
      color: #10b981;
      font-size: 12px;
      font-weight: 600;
    }
    
    .luminabot-booking-success svg {
      width: 24px;
      height: 24px;
      stroke: #10b981;
      stroke-width: 3px;
      fill: none;
    }
  `;
  document.head.appendChild(styleEl);

  // 3. Construct HTML
  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'luminabot-widget-container';
  widgetContainer.innerHTML = `
    <!-- Floating Window -->
    <div class="luminabot-panel" id="luminabotPanel">
      <div class="luminabot-header">
        <div class="luminabot-header-info">
          <div class="luminabot-header-avatar" id="luminabotAvatar">${config.botAvatar}</div>
          <div>
            <div class="luminabot-header-title" id="luminabotTitle">${config.botName}</div>
            <div class="luminabot-header-status">Online</div>
          </div>
        </div>
        <button class="luminabot-close-btn" id="luminabotClose" aria-label="Close chat">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      
      <div class="luminabot-messages" id="luminabotMessages">
        <!-- Messages will be injected here -->
      </div>
      
      <!-- Typing Indicator -->
      <div class="luminabot-typing" id="luminabotTyping">
        <span></span><span></span><span></span>
      </div>

      <div class="luminabot-footer">
        <div class="luminabot-input-row">
          <input type="text" class="luminabot-input" id="luminabotInput" placeholder="${config.placeholder}" autocomplete="off" />
          <button class="luminabot-send-btn" id="luminabotSend" aria-label="Send message">
            <svg viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          </button>
        </div>
        <div class="luminabot-branding">
          Powered by <a href="#" target="_blank" id="luminabotBrandLink">LuminaBot</a>
        </div>
      </div>
    </div>

    <!-- Bubble Trigger -->
    <div class="luminabot-bubble" id="luminabotBubble">
      <svg id="luminabotBubbleIcon" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    </div>
  `;
  
  const targetParent = document.getElementById('luminabot-preview-container') || document.body;
  targetParent.appendChild(widgetContainer);

  // Get DOM references
  const panel = document.getElementById('luminabotPanel');
  const bubble = document.getElementById('luminabotBubble');
  const bubbleIcon = document.getElementById('luminabotBubbleIcon');
  const closeBtn = document.getElementById('luminabotClose');
  const messagesContainer = document.getElementById('luminabotMessages');
  const chatInput = document.getElementById('luminabotInput');
  const sendBtn = document.getElementById('luminabotSend');
  const typingIndicator = document.getElementById('luminabotTyping');

  // SVG Paths
  const chatIconPath = "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z";
  const closeIconPath = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

  // State Management
  let chatHistory = [];
  const storageKey = `luminabot_history_${config.botName.replace(/\s+/g, '_')}`;
  // When running in the builder dashboard, the parent window can pass a botId so the
  // booking form submits real data to the server even in preview/DEMO mode.
  let activeBotIdOverride = null;

  // 4. Initialize History
  function initHistory() {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      chatHistory = JSON.parse(saved);
      chatHistory.forEach(msg => {
        renderMessage(msg.text, msg.role);
      });
    } else {
      // Add welcome message
      addMessage(config.welcomeMsg, 'model');
    }
  }

  function addMessage(text, role) {
    chatHistory.push({ text, role });
    sessionStorage.setItem(storageKey, JSON.stringify(chatHistory));
    renderMessage(text, role);
  }

  function resetChat() {
    messagesContainer.innerHTML = '';
    chatHistory = [];
    sessionStorage.removeItem(storageKey);
    addMessage(config.welcomeMsg, 'model');
  }

  function renderMessage(text, role) {
    const msgEl = document.createElement('div');
    msgEl.className = `luminabot-msg luminabot-msg-${role === 'user' ? 'user' : 'bot'}`;
    
    // Formatting newlines and simple markdown links
    let formattedText = text.replace(/\n/g, '<br>');
    
    // Replace markdown links [Text](Url) with HTML links
    formattedText = formattedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      if (url.startsWith('#')) {
        return `<a href="${url}" class="luminabot-action-link" style="color: inherit; text-decoration: underline; font-weight: 600;">${linkText}</a>`;
      }
      return `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline; font-weight: 500;">${linkText}</a>`;
    });
    
    msgEl.innerHTML = formattedText;
    messagesContainer.appendChild(msgEl);

    // If it's a bot message and contains a Calendly URL, add an inline booking iframe toggle!
    if (role === 'model') {
      const calendlyRegex = /https:\/\/calendly\.com\/[a-zA-Z0-9_#-]+/i;
      const match = text.match(calendlyRegex);
      if (match) {
        const calendlyUrl = match[0];
        
        const bookingContainer = document.createElement('div');
        bookingContainer.style.marginTop = '8px';
        bookingContainer.style.width = '100%';
        bookingContainer.style.maxWidth = '290px';
        bookingContainer.style.alignSelf = 'flex-start';
        
        // Add a beautiful booking button
        const bookBtn = document.createElement('button');
        bookBtn.className = 'luminabot-book-appointment-btn';
        bookBtn.style.backgroundColor = '#10b981'; // Green
        bookBtn.style.color = 'white';
        bookBtn.style.border = 'none';
        bookBtn.style.borderRadius = '8px';
        bookBtn.style.padding = '8px 12px';
        bookBtn.style.fontSize = '12px';
        bookBtn.style.fontWeight = '600';
        bookBtn.style.cursor = 'pointer';
        bookBtn.style.width = '100%';
        bookBtn.style.display = 'flex';
        bookBtn.style.alignItems = 'center';
        bookBtn.style.justifyContent = 'center';
        bookBtn.style.gap = '6px';
        bookBtn.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
        bookBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          Select Date & Time (Inline)
        `;

        // The booking iframe (hidden initially)
        const iframeWrapper = document.createElement('div');
        iframeWrapper.style.display = 'none';
        iframeWrapper.style.marginTop = '8px';
        iframeWrapper.style.borderRadius = '8px';
        iframeWrapper.style.overflow = 'hidden';
        iframeWrapper.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        iframeWrapper.style.height = '320px';
        iframeWrapper.style.backgroundColor = 'white';
        
        const iframe = document.createElement('iframe');
        iframe.src = `${calendlyUrl}?embed_domain=${window.location.hostname}&embed_type=inline`;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframeWrapper.appendChild(iframe);
        
        bookBtn.addEventListener('click', () => {
          const isHidden = iframeWrapper.style.display === 'none';
          iframeWrapper.style.display = isHidden ? 'block' : 'none';
          bookBtn.innerHTML = isHidden 
            ? `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Close Calendar
            ` 
            : `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              Select Date & Time (Inline)
            `;
          setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }, 50);
        });

        bookingContainer.appendChild(bookBtn);
        bookingContainer.appendChild(iframeWrapper);
        messagesContainer.appendChild(bookingContainer);
      }
    }

    // If it's a bot message, config method is builtin, and text contains '#book-form', render the inline booking form card!
    if (role === 'model' && text.includes('#book-form')) {
      const bookingContainer = document.createElement('div');
      bookingContainer.style.marginTop = '8px';
      bookingContainer.style.width = '100%';
      bookingContainer.style.maxWidth = '290px';
      bookingContainer.style.alignSelf = 'flex-start';
      
      const formId = 'form-' + Math.random().toString(36).substring(2, 7);
      bookingContainer.innerHTML = `
        <div class="luminabot-booking-card" id="${formId}">
          <h4>📅 Request Appointment</h4>
          
          <div class="luminabot-booking-field">
            <label>Name</label>
            <input type="text" class="booking-name" placeholder="Your Full Name" required />
          </div>
          
          <div class="luminabot-booking-field">
            <label>Contact Info</label>
            <input type="text" class="booking-contact" placeholder="Email or Phone" required />
          </div>
          
          <div class="luminabot-booking-row">
            <div class="luminabot-booking-field">
              <label>Date</label>
              <input type="date" class="booking-date" required />
            </div>
            <div class="luminabot-booking-field">
              <label>Time</label>
              <input type="time" class="booking-time" required />
            </div>
          </div>
          
          <div class="luminabot-booking-field">
            <label>Notes (Optional)</label>
            <textarea class="booking-notes" placeholder="Reason for visit / special requests" rows="2"></textarea>
          </div>
          
          <button class="luminabot-booking-submit">Confirm Reservation</button>
        </div>
      `;
      
      messagesContainer.appendChild(bookingContainer);
      
      // Set default date to today
      const dateInput = bookingContainer.querySelector('.booking-date');
      if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        dateInput.min = today;
      }
      
      // Handle submit
      const submitBtn = bookingContainer.querySelector('.luminabot-booking-submit');
      submitBtn.addEventListener('click', async () => {
        const nameVal = bookingContainer.querySelector('.booking-name').value.trim();
        const contactVal = bookingContainer.querySelector('.booking-contact').value.trim();
        const dateVal = bookingContainer.querySelector('.booking-date').value;
        const timeVal = bookingContainer.querySelector('.booking-time').value;
        const notesVal = bookingContainer.querySelector('.booking-notes').value.trim();
        
        if (!nameVal || !contactVal || !dateVal || !timeVal) {
          alert('Please fill out all required fields.');
          return;
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        
        try {
          const bookingData = {
            name: nameVal,
            contact: contactVal,
            date: dateVal,
            time: timeVal,
            notes: notesVal
          };
          
          const apiBase = getApiBase();
          let success = false;
          let savedBooking = null;
          
          // Resolve which botId to use: widget attribute, OR builder's active bot override
          const effectiveBotId = botId || activeBotIdOverride;
          
          if (effectiveBotId) {
            // Always submit to server when we have a bot ID (even in DEMO key mode)
            const response = await fetch(`${apiBase}/api/bots/${effectiveBotId}/bookings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bookingData)
            });
            if (response.ok) {
              const resData = await response.json();
              success = true;
              savedBooking = resData.booking;
            } else {
              throw new Error('Failed to submit booking to server');
            }
          } else {
            // DEMO mode: save to localStorage
            const mockId = 'booking-' + Math.random().toString(36).substring(2, 7) + Date.now().toString(36);
            savedBooking = {
              id: mockId,
              botId: botId || 'DEMO',
              botName: config.botName,
              ...bookingData,
              createdAt: new Date().toISOString()
            };
            
            const demoList = JSON.parse(localStorage.getItem('luminabot_demo_bookings') || '[]');
            demoList.unshift(savedBooking);
            localStorage.setItem('luminabot_demo_bookings', JSON.stringify(demoList));
            success = true;
            
            await new Promise(r => setTimeout(r, 600));
          }
          
          if (success) {
            const formCard = document.getElementById(formId);
            formCard.innerHTML = `
              <div class="luminabot-booking-success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Booking Request Sent!
              </div>
            `;
            
            setTimeout(() => {
              addMessage(`🎉 Perfect! I've received your booking request for ${bookingData.date} at ${bookingData.time}. Someone will contact you at ${bookingData.contact} to confirm.`, 'model');
              
              // Post message back to parent window
              window.parent.postMessage({
                type: 'LUMINABOT_LEAD_SUBMITTED',
                booking: savedBooking
              }, '*');
            }, 500);
          }
        } catch (err) {
          console.error(err);
          alert('Submission failed. Please try again.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirm Reservation';
        }
      });
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Toggle Chat
  bubble.addEventListener('click', () => {
    const isActive = panel.classList.toggle('active');
    bubble.classList.toggle('active', isActive);
    
    // Toggle SVG icon
    bubbleIcon.innerHTML = isActive 
      ? `<path d="${closeIconPath}"/>` 
      : `<path d="${chatIconPath}"/>`;
      
    if (isActive) {
      setTimeout(() => chatInput.focus(), 150);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('active');
    bubble.classList.remove('active');
    bubbleIcon.innerHTML = `<path d="${chatIconPath}"/>`;
    resetChat();
  });

  // 5. AI Communication Logic
  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    addMessage(text, 'user');
    
    // Show typing
    typingIndicator.style.display = 'flex';
    messagesContainer.appendChild(typingIndicator); // Ensure it's at the bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      const responseText = await getAIChatCompletion(text);
      typingIndicator.style.display = 'none';
      addMessage(responseText, 'model');
    } catch (err) {
      typingIndicator.style.display = 'none';
      addMessage(`Error: ${err.message || 'Something went wrong.'}`, 'model');
    }
  }

  let activeModel = sessionStorage.getItem('luminabot_active_model') || 'gemini-1.5-flash';

  async function getAIChatCompletion(userPrompt) {
    const apiKey = config.apiKey || scriptEl?.getAttribute('data-api-key') || '';
    
    if (!apiKey) {
      return "Hello! I am ready to help, but no API Key has been configured for this chatbot. Please provide a Gemini API Key in the settings panel to enable AI responses.";
    }

    if (apiKey === 'DEMO') {
      // Mock / Demo Response logic that dynamically adapts to any business/website
      await new Promise(resolve => setTimeout(resolve, 1200)); // Simulate thinking
      
      const query = userPrompt.toLowerCase();
      const promptLower = (config.systemPrompt.split(/instructions:/i)[0] || '').toLowerCase();
      const bizName = config.botName.replace(/ assistant/i, '');
      const bookingUrl = config.calendlyUrl || 'https://calendly.com/mock-dentist';
      
      const bookingLink = config.bookingMethod === 'builtin' ? '#book-form' : bookingUrl;
      const bookingActionWord = config.bookingMethod === 'builtin' ? 'Book Appointment' : 'scheduling tool';

      // 1. Thank you / Closing Chat trigger
      if (query.includes('thank') || query.includes('thanks') || query.includes('danke') || query.includes('vielen dank') || query.includes('merci')) {
        return `You're very welcome! Can we close the chat? [Yes, close chat](#close) or [Keep chatting](#keep)`;
      }

      // 2. Booking & Scheduling trigger
      if (query.includes('book') || query.includes('appointment') || query.includes('schedule') || query.includes('reserve') || query.includes('termin') || query.includes('buchen') || query.includes('reservieren') || query.includes('call') || query.includes('meeting') || query.includes('visite')) {
        let actionWord = "Book Appointment";
        if (config.botAvatar === '🍔') actionWord = "Book Table";
        if (config.botAvatar === '🏠') actionWord = "Schedule Consultation";
        if (config.botAvatar === '💪') actionWord = "Claim Free Pass";
        
        if (config.bookingMethod === 'builtin') {
          return `I'd love to help you book a slot! Please fill out our reservation request form below:\n[${actionWord}](#book-form)`;
        } else {
          return `I'd love to help you book a slot! You can schedule a session directly using our booking tool: [${actionWord}](${bookingUrl}).`;
        }
      }

      // 3. Price / Cost / Menu / Rates trigger (Heuristics-based search of the scraped training text)
      if (query.includes('price') || query.includes('cost') || query.includes('how much') || query.includes('menu') || query.includes('rate') || query.includes('fee') || query.includes('charge') || query.includes('preis') || query.includes('kosten') || query.includes('karte') || query.includes('beer') || query.includes('bier') || query.includes('speisen') || query.includes('getraenke') || query.includes('dishes') || query.includes('pricing') || query.includes('eur') || query.includes('euro') || query.includes('dollar')) {
        const lines = config.systemPrompt.split('\n');
        const matchingLines = [];
        
        // Prioritize matching lines containing the specific keyword from the query
        let specificKeyword = null;
        const keywordsToSearch = ['beer', 'bier', 'pils', 'helles', 'koelsch', 'cleaning', 'whitening', 'checkup', 'leak', 'wire', 'repair', 'rent', 'warm', 'cold', 'smashen', 'burger', 'fries', 'buffet', 'reservierung'];
        for (const kw of keywordsToSearch) {
          if (query.includes(kw)) {
            specificKeyword = kw;
            break;
          }
        }
        
        for (const line of lines) {
          const lineLower = line.toLowerCase();
          if (specificKeyword && lineLower.includes(specificKeyword)) {
            matchingLines.push(line.trim());
          } else if (line.match(/[\d]+([,.]\d+)?\s*(€|\$|£|EUR|usd)/i) || line.match(/(€|\$|£)\s*[\d]+([,.]\d+)?/i)) {
            // Include lines containing prices/numbers near currencies, filtering out template instructions
            if (!lineLower.includes('instruction') && !lineLower.includes('you are') && !lineLower.includes('guide') && !lineLower.includes('output') && !lineLower.includes('exact markdown')) {
              matchingLines.push(line.trim());
            }
          }
        }
        
        if (matchingLines.length > 0) {
          const itemsText = matchingLines.slice(0, 5).join('\n• ');
          return `Based on the website info, here are the prices/details:\n\n• ${itemsText}\n\nWould you like to schedule a visit to discuss this further? [${bookingActionWord}](${bookingLink})`;
        }
        
        // Fallback pricing response
        return `Our rates and pricing depend on the specific project, service, or menu options. Would you like to schedule a consultation to get a detailed quote? [Book Appointment](${bookingLink})`;
      }

      // 4. Real Estate Persona
      if (config.botAvatar === '🏠' || promptLower.includes('realtor') || promptLower.includes('estate') || promptLower.includes('flat') || promptLower.includes('apartment') || promptLower.includes('wohnung') || promptLower.includes('listings') || promptLower.includes('haus')) {
        if (query.includes('rent') || query.includes('miete') || query.includes('warm') || query.includes('cold') || query.includes('kalt')) {
          return `We have options ranging from €800/month cold rent up to €1,050/month warm rent (utilities included). Let me know what your preferred budget is!`;
        }
        return `Welcome to our Real Estate office! Are you looking to buy, rent, or sell a property? I can search active listings or schedule a free call with an agent: [Schedule Consultation](${bookingLink}).`;
      }

      // 5. Trades & Service Trades (Plumber/Electrician/Locksmith/etc.)
      if (promptLower.includes('plumb') || promptLower.includes('electric') || promptLower.includes('leak') || promptLower.includes('wiring') || promptLower.includes('repair') || promptLower.includes('emergency') || promptLower.includes('locksmith') || promptLower.includes('craftsman')) {
        if (query.includes('emergency') || query.includes('urgent') || query.includes('broken') || query.includes('leak') || query.includes('pipe') || query.includes('wire') || query.includes('outage') || query.includes('lock')) {
          return `We handle emergency repair dispatches immediately! Please describe the issue (e.g. pipe leak, power failure, locked out) so we can send a technician, or schedule an immediate booking: [Book Service](${bookingLink}).`;
        }
        return `Hello! We offer professional installations, emergency repairs, and maintenance. Could you share a few details about the project or issue you'd like us to help with?`;
      }

      // 6. Portfolio / Personal CV Persona
      if (promptLower.includes('portfolio') || promptLower.includes('resume') || promptLower.includes('skills') || promptLower.includes('projects') || promptLower.includes('developer') || promptLower.includes('designer') || promptLower.includes('work') || promptLower.includes('cv')) {
        return `Hi there! I am the personal assistant representing my owner's professional portfolio. Feel free to ask about key projects, technical skills, or work history. If you'd like to chat or discuss a project, book a slot: [Schedule Meeting](${bookingLink}).`;
      }

      // 7. General fallback (Emulates business name and system prompt details)
      return `Welcome to ${bizName}! I can help you learn about our services, pricing, or book an appointment. How can I assist you today?`;
    }

    // Call actual Gemini API with fallback pipeline
    const modelsToTry = [activeModel, 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
    const uniqueModels = Array.from(new Set(modelsToTry));

    // Extract training data block from systemPrompt to pass as context in contents rather than systemInstructions.
    // This removes heavy verbatim text from the core programming, drastically reducing recitation safety blocks.
    let cleanSystemPrompt = config.systemPrompt;
    let trainingData = '';
    
    const trainingStart = config.systemPrompt.indexOf('WEBSITE TRAINING DATA:');
    if (trainingStart !== -1) {
      const instructionsStart = config.systemPrompt.indexOf('INSTRUCTIONS:');
      if (instructionsStart !== -1) {
        let beforeInstructions = config.systemPrompt.lastIndexOf('---', instructionsStart);
        if (beforeInstructions === -1 || beforeInstructions < trainingStart) {
          beforeInstructions = instructionsStart;
        }
        trainingData = config.systemPrompt.substring(trainingStart + 'WEBSITE TRAINING DATA:'.length, beforeInstructions).trim();
        
        let firstSeparator = config.systemPrompt.indexOf('---');
        if (firstSeparator === -1 || firstSeparator > trainingStart) {
          firstSeparator = trainingStart;
        }
        cleanSystemPrompt = config.systemPrompt.substring(0, firstSeparator).trim() + 
                            '\n\n' + 
                            config.systemPrompt.substring(instructionsStart).trim();
      } else {
        trainingData = config.systemPrompt.substring(trainingStart + 'WEBSITE TRAINING DATA:'.length).trim();
        cleanSystemPrompt = config.systemPrompt.substring(0, trainingStart).trim();
      }
    }

    // Map history into Gemini's expected API format, merging consecutive messages of the same role
    // to strictly satisfy alternating roles (user -> model -> user) and prepending training data.
    const contents = [];
    let trainingDataPrepended = false;
    
    chatHistory.forEach(msg => {
      const role = msg.role === 'user' ? 'user' : 'model';
      let textToSubmit = msg.text;
      
      if (msg.role === 'user' && !trainingDataPrepended && trainingData) {
        textToSubmit = `[Website Context / Training Data for Reference]\n${trainingData}\n\n[Visitor Query]\n${msg.text}`;
        trainingDataPrepended = true;
      }
      
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        // Merge consecutive messages of the same role to satisfy strict alternating roles schema
        contents[contents.length - 1].parts[0].text += '\n\n' + textToSubmit;
      } else {
        contents.push({
          role: role,
          parts: [{ text: textToSubmit }]
        });
      }
    });

    let lastError = null;

    for (const modelName of uniqueModels) {
      try {
        console.log(`Attempting Gemini API request using model: ${modelName}`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: contents,
            systemInstruction: {
              parts: [{ text: cleanSystemPrompt }]
            },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 500
            }
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errMsg = errorData.error?.message || `API error: ${response.status}`;
          console.warn(`Model ${modelName} failed: ${errMsg}`);
          
          const err = new Error(errMsg);
          err.status = response.status;
          lastError = err;
          
          // Throw immediately and abort model retries on key/permission/rate-limit blocks
          if (response.status === 429 || response.status === 403 || response.status === 400) {
            throw err;
          }
          continue;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        
        if (!text) {
          lastError = new Error("No response generated from the AI model.");
          continue;
        }

        const finishReason = candidate?.finishReason;
        let processedText = text;
        if (finishReason && finishReason !== 'STOP') {
          console.warn(`[LuminaBot] Gemini response finished with status: ${finishReason}. Performing immediate regex cleanup...`);
          
          if (processedText && processedText.trim()) {
            let trimmed = processedText.trim();
            // Clean up trailing prepositions, articles, quotes, or currency symbols cut off mid-sentence
            trimmed = trimmed.replace(/\s*(is|at|for|priced|costing|with|are|about|the|our|my|a|an|to|in|of|and|but|or)?\s*(€|\$|£|eur|usd|gbp|["'“‘])?$/i, '');
            if (!trimmed.endsWith('.') && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
              trimmed += '.';
            }
            processedText = trimmed + " (Note: Some price/menu details were omitted. Please ask again or check details directly).";
          } else {
            // Completely empty or blocked from the first token
            processedText = "I apologize, but I am unable to display that information right now. Would you like to check the website directly or schedule a call with us? [Book Appointment](" + (config.bookingMethod === 'builtin' ? '#book-form' : (config.calendlyUrl || '')) + ")";
          }
        }

        // Cache the working model
        activeModel = modelName;
        sessionStorage.setItem('luminabot_active_model', modelName);

        // Update dashboard model display if running in dashboard mockup
        const fallbackModelEl = document.getElementById('fallback-model');
        if (fallbackModelEl) {
          fallbackModelEl.textContent = `Gemini (${modelName})`;
        }

        return processedText;
      } catch (error) {
        console.error(`Gemini API call failed for ${modelName}:`, error);
        lastError = error;
        
        // Propagate key, permission, validation, or rate limit blocks immediately to stop retry loop
        if (error.status === 429 || error.status === 403 || error.status === 400) {
          throw error;
        }
        
        if (error.message && (error.message.includes('429') || error.message.includes('403') || error.message.includes('400') || error.message.includes('API key') || error.message.includes('quota'))) {
          throw error;
        }
        continue;
      }
    }

    throw lastError || new Error("Failed to connect to any Gemini model.");
  }

  // Input Listeners
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  sendBtn.addEventListener('click', handleSend);

  // Action link clicks (Yes, close chat / Keep chatting)
  messagesContainer.addEventListener('click', (e) => {
    const target = e.target.closest('a');
    if (!target) return;
    
    const href = target.getAttribute('href');
    if (href === '#close') {
      e.preventDefault();
      // Collapse chat panel
      panel.classList.remove('active');
      bubble.classList.remove('active');
      bubbleIcon.innerHTML = `<path d="${chatIconPath}"/>`;
      resetChat();
    } else if (href === '#keep') {
      e.preventDefault();
      // Update action links to text
      const msgEl = target.closest('.luminabot-msg');
      if (msgEl) {
        msgEl.innerHTML = msgEl.innerHTML.replace(/<a[^>]*href="#close"[^>]*>.*?<\/a>/gi, 'Yes, close chat')
                                           .replace(/<a[^>]*href="#keep"[^>]*>.*?<\/a>/gi, 'Keep chatting');
      }
      addMessage("Okay! Let me know if you have any other questions.", 'model');
    }
  });

  // Calendly Event Scheduled Listener
  window.addEventListener('message', (e) => {
    if (e.data?.event === 'calendly.event_scheduled') {
      console.log('Calendly event scheduled:', e.data);
      addMessage("🎉 Appointment booked! You will receive a confirmation email shortly.", 'model');
    }
  });

  // Initialize
  initHistory();

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'LUMINABOT_CONFIG_UPDATE') {
      const newConfig = event.data.config;
      
      // Update the active bot ID override (set by the builder dashboard after saving)
      if (event.data.activeBotId !== undefined) {
        activeBotIdOverride = event.data.activeBotId;
      }
      
      // Update variables
      config.apiKey = newConfig.apiKey;
      config.botName = newConfig.botName;
      config.themeColor = newConfig.themeColor;
      config.welcomeMsg = newConfig.welcomeMsg;
      config.systemPrompt = newConfig.systemPrompt;
      config.botAvatar = newConfig.botAvatar;
      config.bookingMethod = newConfig.bookingMethod || 'builtin';
      config.calendlyUrl = newConfig.calendlyUrl;

      // Update DOM
      const titleEl = document.getElementById('luminabotTitle');
      const avatarEl = document.getElementById('luminabotAvatar');
      const bubbleEl = document.getElementById('luminabotBubble');
      const sendBtnEl = document.getElementById('luminabotSend');
      const inputEl = document.getElementById('luminabotInput');

      if (titleEl) titleEl.textContent = config.botName;
      if (avatarEl) avatarEl.textContent = config.botAvatar;
      if (bubbleEl) bubbleEl.style.backgroundColor = config.themeColor;
      if (sendBtnEl) sendBtnEl.style.backgroundColor = config.themeColor;
      if (inputEl) {
        inputEl.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        // Focus state CSS is handled dynamically:
        inputEl.addEventListener('focus', () => inputEl.style.borderColor = config.themeColor);
        inputEl.addEventListener('blur', () => inputEl.style.borderColor = 'rgba(255, 255, 255, 0.1)');
      }

      // Re-initialize welcome message if history is empty or reset
      if (event.data.resetHistory) {
        resetChat();
      }
    }
  });

  } // end initWidget

})();
