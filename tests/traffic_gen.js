// traffic_gen.js
// Run this script in the console of the tab you are capturing to verify the extension.

(async () => {
  const log = (msg) => console.log(`[TrafficGen] ${msg}`);

  log("Starting traffic generation...");

  // 1. GET Request
  try {
    log("Sending GET request...");
    await fetch('https://httpbin.org/get?test=reqres_get');
  } catch(e) { log("GET failed: " + e); }

  // 2. POST Request (JSON)
  try {
    log("Sending POST request...");
    await fetch('https://httpbin.org/post?test=reqres_post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: "world", timestamp: Date.now(), source: "ReqRes" })
    });
  } catch(e) { log("POST failed: " + e); }

  // 3. PUT Request
  try {
    log("Sending PUT request...");
    await fetch('https://httpbin.org/put?test=reqres_put', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: "Updating resource..."
    });
  } catch(e) { log("PUT failed: " + e); }

  // 4. DELETE Request
  try {
    log("Sending DELETE request...");
    await fetch('https://httpbin.org/delete?test=reqres_delete', { method: 'DELETE' });
  } catch(e) { log("DELETE failed: " + e); }

  // 5. HEAD Request
  try {
    log("Sending HEAD request...");
    await fetch('https://httpbin.org/headers?test=reqres_head', { method: 'HEAD' });
  } catch(e) { log("HEAD failed: " + e); }

  // 6. Redirect (302)
  // This should generate two entries in the dashboard:
  // 1. The initial request (Status 302)
  // 2. The redirected request (Status 200)
  try {
    log("Sending Redirect Request...");
    await fetch('https://httpbin.org/redirect-to?url=https%3A%2F%2Fhttpbin.org%2Fget%3Fredirected%3Dtrue');
  } catch(e) { log("Redirect failed: " + e); }

  log("Traffic generation complete. Check the Dashboard.");
})();
