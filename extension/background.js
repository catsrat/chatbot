// Register declarativeNetRequest rules to strip X-Frame-Options and Content-Security-Policy
// from responses so they can be loaded in the Live Website View iframe
async function setupRules() {
  const rules = [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' }
        ]
      },
      condition: {
        resourceTypes: ['sub_frame']
      }
    }
  ];

  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(r => r.id);
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rules
    });
    console.log('Frame header bypass rules registered successfully.');
  } catch (err) {
    console.error('Failed to register frame header bypass rules:', err);
  }
}

// Initialize rules on worker start
setupRules();

// Headless rendering fetch: loads the URL in a background tab,
// waits for Wix/SPA client-side JS to render, and extracts the rendered HTML.
async function fetchRenderedHTML(url) {
  console.log(`Starting headless background tab render for: ${url}`);
  const tab = await chrome.tabs.create({ url: url, active: false });
  const tabId = tab.id;

  try {
    // Wait for the tab status to become 'complete' (up to 15 seconds) if not already loaded
    if (tab.status !== 'complete') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error("Headless page load timed out"));
        }, 15000);

        function listener(updatedTabId, changeInfo) {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    }

    // Give Wix/React client-side bundles 2.5 seconds to query and build the DOM
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Extract the fully rendered HTML (preserves <a> links for subpage discovery)
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => document.documentElement.outerHTML
    });

    const html = results?.[0]?.result || '';
    if (!html || html.trim().length < 100) {
      throw new Error("Extracted HTML is empty or invalid");
    }
    console.log(`Extracted ${html.length} chars of rendered HTML from: ${url}`);
    return html;
  } finally {
    // Always clean up and close the tab
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {
      console.warn("Failed to close headless tab:", e);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL') {
    (async () => {
      try {
        if (message.url.toLowerCase().endsWith('.pdf')) {
          console.log(`Extension background script fetching PDF binary: ${message.url}`);
          const res = await fetch(message.url);
          if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
          const buffer = await res.arrayBuffer();
          // Convert arrayBuffer to Base64 safely
          const bytes = new Uint8Array(buffer);
          let binaryString = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binaryString += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const base64 = btoa(binaryString);
          sendResponse({ pdfBase64: base64 });
        } else {
          // Try background tab rendering first for client-side JS / Wix support
          const html = await fetchRenderedHTML(message.url);
          sendResponse({ html });
        }
      } catch (err) {
        console.warn(`Headless background render failed, falling back to static fetch:`, err);
        try {
          const res = await fetch(message.url);
          if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
          if (message.url.toLowerCase().endsWith('.pdf')) {
            const buffer = await res.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binaryString = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binaryString += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binaryString);
            sendResponse({ pdfBase64: base64 });
          } else {
            const html = await res.text();
            sendResponse({ html });
          }
        } catch (fetchErr) {
          console.error('Static fetch fallback also failed:', fetchErr);
          sendResponse({ error: fetchErr.message });
        }
      }
    })();
    return true; // Keep messaging channel open for asynchronous reply
  }
});
