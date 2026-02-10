# ReqRes DevTools Lite v3

## Overview

ReqRes DevTools Lite is a powerful Chrome Extension designed to emulate sophisticated HTTP/HTTPS sniffing and analysis tools like HTTP Canary or Fiddler, but directly within the browser environment. It leverages the Chrome Debugger API to provide transparent interception of network traffic without the need for complex proxy configurations or external certificate installation.

## Key Features

- **Transparent Interception**: Captures both HTTP and HTTPS traffic seamlessly using the browser's native debugging protocol.
- **Detailed Logging**: Records request methods, URLs, headers, bodies, and response status codes, headers, and payloads.
- **Replay & Edit**: Easily replay captured requests or edit them (method, headers, body) before resending.
- **Advanced Filtering**: Filter traffic by method (e.g., `method:POST`), status (e.g., `status:404`), domain, or keyword.
- **Export Options**: Export captured sessions to ZIP (readable text files), JSON, or copy individual requests as cURL commands.
- **Security & Privacy**: Operates entirely locally. No traffic is sent to external servers.

## How It Works

This extension uses the `chrome.debugger` API to attach to a specific tab. This allows it to:
1.  Listen to `Network` events directly from the browser's network stack.
2.  Capture decrypted traffic even for HTTPS connections (Man-in-the-Browser).
3.  Inject scripts via `chrome.scripting` to replay requests in the context of the original page.

**Note on Certificates**: Unlike external proxies (e.g., Charles, mitmproxy) that require installing a Root CA to decrypt HTTPS, this extension sees the traffic *after* the browser has decrypted it. This simplifies setup and avoids security warnings related to untrusted certificates, provided the browser trusts the site.

## Usage

1.  Click the extension icon and select "Start Capture & Open Dashboard".
2.  A new Dashboard tab will open, and the extension will attach to the active tab.
3.  Browse the website in the attached tab. Requests will appear in the Dashboard.
4.  **Filter**: Use the search bar to filter. Supports prefixes:
    - `method:GET`
    - `status:200`
    - `type:xhr`
5.  **Replay**: Select a request, go to the "Response" or "Preview" tab (or use the toolbar if available) and click "Replay".
6.  **Edit**: Click "Edit & Resend" to modify the request before sending.

## Privacy & Legal

- **Local Only**: All captured data is stored in memory or the local extension storage. It is never transmitted to the developer or third parties.
- **Compliance**: This tool is intended for development, debugging, and security analysis of applications you own or have permission to test.
- **Traffic Interception**: The "Transparent Interception" capability is powerful. Ensure you comply with all applicable laws and regulations regarding network monitoring and data privacy in your jurisdiction.

## Development

- `bg.js`: Background service worker handling the Debugger API and state.
- `dashboard.html/js`: The frontend interface for viewing and managing logs.
- `manifest.json`: Extension configuration (Manifest V3).

## License

[MIT License](LICENSE)
