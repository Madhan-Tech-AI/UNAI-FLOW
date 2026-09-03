/**
 * UNAI Email Gateway — Gmail OAuth2 Token Generator
 * 
 * Run this script ONCE to get your Gmail OAuth2 refresh token.
 * The refresh token never expires unless you manually revoke it.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Create a project (or use existing)
 *   3. Enable the Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
 *   4. Create OAuth2 credentials:
 *      - Click "Create Credentials" → "OAuth client ID"
 *      - Application type: "Desktop app"
 *      - Copy Client ID and Client Secret
 *
 * Usage:
 *   node scripts/get-gmail-token.js <CLIENT_ID> <CLIENT_SECRET>
 */

import { google } from 'googleapis';
import * as http from 'http';
import open from 'open';

const clientId = process.argv[2];
const clientSecret = process.argv[3];

if (!clientId || !clientSecret) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        UNAI Email Gateway — Gmail Token Generator            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Usage:                                                      ║
║    node scripts/get-gmail-token.js <CLIENT_ID> <CLIENT_SECRET>║
║                                                              ║
║  Steps to get Client ID & Secret:                            ║
║                                                              ║
║  1. Go to: https://console.cloud.google.com                  ║
║  2. Create a new project (or select existing)                ║
║  3. Enable Gmail API:                                        ║
║     https://console.cloud.google.com/apis/library/           ║
║     gmail.googleapis.com                                     ║
║  4. Go to Credentials → Create Credentials →                ║
║     OAuth client ID → Desktop app                            ║
║  5. Copy Client ID and Client Secret                         ║
║  6. Run this script with those values                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3333/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n📧 Opening browser for Google authorization...\n');

// Create a temporary HTTP server to receive the OAuth2 callback
const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth2callback')) return;

  const url = new URL(req.url, 'http://localhost:3333');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Error: No authorization code received</h1>');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#fff">
        <h1 style="color:#22c55e">✅ Gmail Authorization Successful!</h1>
        <p>You can close this window and return to your terminal.</p>
      </body></html>
    `);

    console.log('\n' + '═'.repeat(70));
    console.log('  ✅ SUCCESS! Add these environment variables to your Render service:');
    console.log('═'.repeat(70));
    console.log(`\n  GMAIL_CLIENT_ID=${clientId}`);
    console.log(`  GMAIL_CLIENT_SECRET=${clientSecret}`);
    console.log(`  GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`  GMAIL_USER_EMAIL=<your-gmail-address@gmail.com>`);
    console.log('\n' + '═'.repeat(70));
    console.log('  These tokens never expire unless you manually revoke them.');
    console.log('═'.repeat(70) + '\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error exchanging code: ${err}</h1>`);
    console.error('Token exchange error:', err);
  }
});

server.listen(3333, () => {
  console.log('Waiting for OAuth2 callback on http://localhost:3333...');
  // Try to open browser, fall back to manual
  try {
    import('open').then((mod) => mod.default(authUrl)).catch(() => {
      console.log(`\n🔗 Open this URL in your browser:\n\n${authUrl}\n`);
    });
  } catch {
    console.log(`\n🔗 Open this URL in your browser:\n\n${authUrl}\n`);
  }
});
