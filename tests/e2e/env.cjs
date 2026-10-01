// Settings for the end-to-end tests, read from environment variables so no
// one's personal paths are committed.
//
//   SPIN_SERVICE_ACCOUNT  path to a Firebase service-account key (.json) for
//                         spin-kn-fleet. Never commit this file.
//   CHROME_PATH           Chrome or Edge executable (optional; common
//                         Windows, macOS and Linux locations are tried).
const fs = require('node:fs');

const KEY = process.env.SPIN_SERVICE_ACCOUNT;
if (!KEY || !fs.existsSync(KEY)) {
  console.error('Set SPIN_SERVICE_ACCOUNT to the path of the spin-kn-fleet service-account key (.json). See tests/README.md.');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = candidates.find(p => fs.existsSync(p));

module.exports = { KEY, CHROME };
