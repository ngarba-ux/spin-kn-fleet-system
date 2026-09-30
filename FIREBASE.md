# SPIN-KN Fleet on Firebase

The new version of SPIN-KN Fleet runs on Firebase:

- **Hosting:** HTTPS at `https://spin-kn-fleet.web.app`
- **Authentication:** email and password sign-in
- **Firestore:** the database, with offline support on phones
- **Storage:** receipts, odometer photos and request documents
- **Cloud Functions:** all workflow rules and emails

The original Windows app (`server/`, `public/`) is left untouched until the switchover.

| Folder / file | What it is |
|---|---|
| `functions/` | Cloud Functions (TypeScript). Every change to the data goes through these, inside transactions. |
| `web/` | React + Vite app. Installs to the home screen and works without signal. |
| `firestore.rules`, `storage.rules` | Who can read what. Clients can write almost nothing directly. |
| `scripts/import-db.mjs` | One-off import of the old `data/db.json` |

Firebase project: **`spin-kn-fleet`**. Region: **europe-west1**.
Console: <https://console.firebase.google.com/project/spin-kn-fleet>

## 1. One-time console setup

These steps need the project owner (ahmanur@gmail.com) in the Firebase console.

1. **Upgrade to the Blaze plan.** Go to *Project overview → Upgrade*. Cloud Functions and Storage require it.
   - Also set a budget alert, for example $10 a month, under *Google Cloud → Billing → Budgets*.
   - A fleet this size normally stays inside the free allowance.
2. **Create the database.**
   - Go to *Build → Firestore Database → Create database*.
   - Location: **europe-west1 (Belgium)**.
   - Mode: **production**. Our rules replace the default ones on the first deploy.
3. **Turn on sign-in.** Go to *Build → Authentication → Get started → Sign-in method* and enable **Email/Password**.
4. **Create file storage.** Go to *Build → Storage → Get started* and choose location **europe-west1**.
5. **Set up email sending.**
   - Go to *Extensions* and install **Trigger Email from Firestore** (`firebase/firestore-send-email`).
   - Email documents collection: `mail`
   - SMTP connection URI: for example `smtps://user:password@smtp.yourhost.com:465`
   - Default FROM: `SPIN KN Fleet Management <fleet@spinkano.com.ng>`
   - Until this is installed, emails are still recorded in `mail`, but not sent.
6. **Download an admin key for the import.** Go to *Project settings → Service accounts → Generate new private key*.
   - Save the file outside OneDrive if you can.
   - It is full admin access, so never commit or share it. `.gitignore` already blocks common key file names.

## 2. Deploy

Run from the repository root:

```bash
npm --prefix functions install
npm --prefix web install
firebase deploy                      # rules, indexes, functions, hosting
```

To deploy only one part: `firebase deploy --only functions`, `--only hosting`, or `--only firestore:rules,storage`.

## 3. Import the data

```bash
# Everything from the old app (keeps staff QR tokens, so printed cards still work):
node scripts/import-db.mjs --key C:\keys\spin-kn-fleet-admin.json --db path\to\data\db.json

# Or a fresh start (staff directory + admin and SPC accounts only):
node scripts/import-db.mjs --key C:\keys\spin-kn-fleet-admin.json

# Check first without writing anything:
node scripts/import-db.mjs --key ... --db ... --dry-run
```

- Every account gets a **new temporary password**, because Firebase can't reuse the old password hashes.
- The passwords are saved to `data/firebase-temp-passwords.csv`. Hand them out, then delete the file.
- Everyone chooses their own password at first sign-in.

## 4. Point the QR cards at the new site

- Cards from the old system encode `http://<office PC>:3000/#s=<token>`. The tokens are imported, but the address on the card is the old server.
- Reprint the cards so they point to `https://spin-kn-fleet.web.app/#s=<token>`. Printing QR cards from the new app arrives with the Staff & QR screen.
- For a custom address such as `fleet.spinkano.com.ng`: go to *Hosting → Add custom domain*, then set `publicBaseUrl` in the `settings/app` document so email links use it.

## How it works

- **The office acts through Cloud Functions.** Forward, approve, dispatch and the other steps each run in a single transaction. A failed step changes nothing, including queued emails.
- **The office sees live data.** Screens update the moment anything changes, with no polling.
- **Drivers work offline.**
  - Trip start, stop, end, fuel and task acknowledgement are written to `driverActions/{id}`.
  - The Firestore SDK keeps these on the phone without signal and uploads them in order.
  - The `onDriverAction` trigger applies each driver's actions in sequence and marks each one `applied` or `rejected` with a reason.
  - The installed app (service worker) opens with no signal.
- **Photos need a connection** at the moment they are taken. Offline, the reading is still recorded without the photo. (A queue that uploads offline photos later is planned.)
- **Staff have no account.** Their QR token is checked by the `staffPortal` function. The tokens live in `staffSecrets`, which only the admin can read.
- **Roles are stored on each account** (Auth custom claims: `role`, `mustChangePassword`). The security rules and functions check them.

## Local development

```bash
npm --prefix web run dev            # http://localhost:5173 against the live project
npm --prefix functions run build
```

The Firebase emulators (`firebase emulators:start`) need Java 11+, which isn't installed on this PC yet.

## Status

- **Phase 1, done:**
  - Backend, rules, sign-in and password change
  - Full trip-request workflow, staff QR portal and status page
  - Office dashboard and requests inbox
  - Driver app: tasks, trips, stops, fuel, offline
  - Email and the import script
- **Next:** office screens for vehicles, drivers, tasks, trips, fuel and service, staff and QR printing, user accounts, reports, activity log, email log and settings. Their Cloud Functions already exist.
