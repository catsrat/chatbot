# LuminaBot Scraper Helper Extension

This is a lightweight developer Chrome Extension that allows the LuminaBot builder dashboard to scrape client websites that are protected by strict CORS (Cross-Origin Resource Sharing) policies or CDN security firewalls (like Wix, Squarespace, and Cloudflare).

## How to Install (Developer Mode)

1. Open Google Chrome.
2. In the address bar, go to: `chrome://extensions/`
3. In the top-right corner, toggle the **Developer mode** switch to **ON**.
4. In the top-left corner, click **Load unpacked**.
5. Select the `extension/` folder located inside your `luminabot-builder` project directory:
   `/Users/pvsheram/.gemini/antigravity-ide/scratch/luminabot-builder/extension`
6. Click **Select** (or **Open**).

## Access to File URLs (Optional)
If you are running the builder dashboard locally using the `file://` protocol rather than `http://localhost`, follow these extra steps:
1. Locate the **LuminaBot Scraper Helper** card in `chrome://extensions/`.
2. Click **Details**.
3. Scroll down and toggle **Allow access to file URLs** to **ON**.

Once installed, refresh the LuminaBot dashboard page, and the scraper status will display: 
`🟢 Extension active (Bypasses CORS/CDN)`.
