# SPIN-KN Fleet: legacy Windows app

> **Legacy.** This describes the original single-PC version (`server/`, `public/`, `start-server.*`). It's kept for reference until the office has fully switched to the Firebase app at <https://spin-kn-fleet.web.app>. New work goes into the Firebase app. See the [main README](../README.md).

Fleet management for SPIN Kano (Sustainable Power and Irrigation for Nigeria, Kano State):

- **Staff** request a vehicle by scanning the QR code on their staff ID card. No account is needed.
- **Logistics & Transport** (admin) reviews each request and forwards it to the **SPC** for a decision.
- A **driver** is then dispatched. Drivers log trips, stops, fuel and odometer readings from their phones, even with no signal.

The app runs on any Windows 10/11 PC with **nothing to install**. It uses the Windows PowerShell and .NET that come with Windows.

## Start it

1. Double-click **`start-server.bat`** and keep the window open.
2. On the same PC, open <http://localhost:3000>.

The first start creates the database and prints the starter accounts. Each account must choose a new password at first sign-in.

| Role | Email | First password |
|---|---|---|
| Admin (Logistics & Transport) | yasjibril@spinkano.com.ng | admin123 |
| SPC | ainuraddeen@spinkano.com.ng | spc123 |
| Drivers (demo) | musa@ / aisha@ / fatima@ / ibrahim@spin-kn.ng | driver123 |

The demo drivers, vehicles and trips can be deleted in one click: **Settings → Remove demo records**. The 19 staff records are the real staff directory, so they are kept.

## Let phones connect (office network)

1. Right-click **`enable-network-access.bat`** and run it once. It asks for Administrator permission. It reserves port 3000 and opens the firewall on private networks only.
2. Restart `start-server.bat`. The window now shows the network address, for example `http://192.168.1.10:3000`.
3. Open that address on any device, then go to **Settings → Network address → Use …**. QR cards and email links use this address.
4. Print the cards from **Staff & QR → Print all QR cards**.

Give the server PC a fixed (reserved) IP address on your router. If the address changes, printed cards stop working.

## Email

Notifications (request received, approved, declined, rescheduled, driver assigned, and so on) are always recorded under **Email notifications**. To actually send them:

1. Fill in `smtp` in `server/config.json`: `host`, `port`, `enableSsl`, `user`, `password`, `from`.
2. Restart the server.

Emails recorded while sending was off can be re-sent from the Email notifications page.

## Data & backups

- **Database:** everything is stored in `data/db.json`.
- **Uploaded files:** receipts, odometer photos and supporting documents are in `data/uploads/`.
- **Automatic backup:** a copy is saved daily to `data/backups/`; the last 30 are kept.
- **Manual backup:** Settings → **Download full backup**.
- **Restore:** stop the server, replace `data/db.json` with a backup, then start it again.

## Good to know

- **GPS and the camera on phones need HTTPS.** Browsers only allow location and in-app camera access over `https://` or on `localhost`. On plain `http://` over the network:
  - Trips are still recorded, just without coordinates.
  - The odometer and receipt photo buttons still work, because they use the phone's own camera app.
  - For GPS, serve the app over HTTPS, for example behind a reverse proxy with a certificate.
- **Offline driving:** once a driver has the app open, anything they record without signal is saved on the phone and uploads automatically when they reconnect. Nothing is recorded twice.
- **QR cards are credentials.** Anyone holding a card can request trips in that person's name. If a card is lost, revoke or regenerate it under Staff & QR. Each installation generates its own tokens on first start, so cards printed from the original prototype do not work. Print new cards from Staff & QR.

## Project layout

```
start-server.bat / .ps1     launcher (compiles server/*.cs in memory)
enable-network-access.bat   one-time network setup (admin)
server/                     C# server: models, workflow rules, auth, email, HTTP
  config.json               port, time zone, session length, SMTP
public/                     browser app (Preact + htm, no build step)
  js/views/                 screens: landing, staff, status, driver, office pages
  vendor/                   Preact/htm and the QR generator, stored locally for offline use
data/                       created at first start (database, uploads, backups)
legacy/                     the original single-file prototype, for reference
```

## Security summary

- **Passwords:** salted PBKDF2-SHA256 hashes (120,000 iterations). Every account must choose its own password at first sign-in.
- **Brute-force protection:** sign-in locks for 15 minutes after 5 wrong passwords per account, or 20 per IP address.
- **Sessions:** HttpOnly cookies. The office signs out after 12 hours; drivers stay signed in for 30 days.
- **Server-side checks:** permissions and workflow rules are all enforced on the server. For example, the SPC cannot edit the fleet, and drivers can only touch their own trips.
- **Web protections:**
  - CSRF header check on every change.
  - Content-Security-Policy and path-traversal protection.
  - Uploads are checked by type and size.
- **Failure safety:** a failed request never leaves half-applied changes, because the server rolls back to the last saved state.
