// 1. Inject DOM Marker to let index.js know the helper extension is installed
const marker = document.createElement('div');
marker.id = 'luminabot-extension-active';
marker.style.display = 'none';
if (document.documentElement) {
  document.documentElement.appendChild(marker);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.appendChild(marker);
  });
}

// 2. Relay messages: Page Context -> Extension Context -> Page Context
window.addEventListener('message', (event) => {
  // Only accept messages from the current window frame
  if (event.source !== window || !event.data) return;

  if (event.data.type === 'LUMINABOT_EXTENSION_FETCH') {
    const { url, requestId } = event.data;

    chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, (response) => {
      // Send response payload back to the page context
      window.postMessage({
        type: 'LUMINABOT_EXTENSION_RESPONSE',
        requestId,
        url,
        html: response?.html || null,
        error: response?.error || null
      }, '*');
    });
  }
});
