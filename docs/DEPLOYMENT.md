# Deployment and operations

Everything about the Firebase project `spin-kn-fleet`: one-time setup, deploying, data import, email, secrets, backups and access.

- **Console:** <https://console.firebase.google.com/project/spin-kn-fleet>
- **Region:** `europe-west1` (Belgium) for Firestore, Functions and Storage. It's the closest region with a fast route from Nigeria.
- **Plan:** Blaze (pay as you go). Set a budget alert under Google Cloud → Billing → Budgets.

## Current setup

All of this is done already:

| Part | State |
|---|---|
| Firebase project, web app, Blaze plan | ✅ |
| Firestore (`europe-west1`), rules and indexes | ✅ deployed |
| Authentication (email and password) | ✅ |
| Storage (`spin-kn-fleet.firebasestorage.app`) and rules | ✅ deployed |
| Cloud Functions (20) | ✅ deployed |
| Hosting at <https://spin-kn-fleet.web.app> | ✅ deployed |
| Trigger Email extension (fleet@spinkano.com.ng) | ✅ installed and tested |
| Data | Fresh start: 19 staff with QR tokens, accounts for Yasir (admin), Isah (SPC) and Ahmad Isah (super) |

## Deploying

Run from the repository root on an up-to-date `main`:

```bash
firebase deploy --only hosting                               # web app (builds web/ first)
firebase deploy --only firestore:rules,firestore:indexes,storage
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions --force
firebase deploy --only extensions                            # email extension config
```

- **`--force`:** needed because `onDriverAction` retries on failure, which a non-interactive deploy must confirm.
- **`FUNCTIONS_DISCOVERY_TIMEOUT=120`:** gives the CLI time to load the functions code on slow disks. In PowerShell, run `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'` first.
- **Sharing the project:** there is only one project, used by everyone, so a deploy affects real users straight away. Tell the team before deploying, and check the live site afterwards.

**Rolling back:**
- **Hosting:** Firebase console → Hosting → release history → Roll back.
- **Functions and rules:** check out the previous commit and deploy again.

## Email

Notifications are documents in the `mail` collection. The **Trigger Email** extension (`firebase/firestore-send-email@0.2.10`) sends them.

| Setting | Value |
|---|---|
| SMTP server | `mail.spinkano.com.ng:465` (SSL), hosted by QServers cPanel |
| Login and sender | `fleet@spinkano.com.ng`, shown as "SPIN KN Fleet Management"; replies go to the same address |
| Password | Google Secret Manager secret `firestore-send-email-SMTP_PASSWORD`, **pinned to a version** in `extensions/firestore-send-email.env` |
| Config file | `extensions/firestore-send-email.env` (committed; it has no secrets) |

**Changing the mailbox password:**
1. Change it in cPanel → Email Accounts → `fleet@spinkano.com.ng` → Manage.
   - Check it by **typing** the password at <https://mail.spinkano.com.ng:2096>.
   - cPanel's "Check Email" button doesn't ask for the password, so it proves nothing.
2. Add it as a **new version** of the secret: Google Cloud console → Security → Secret Manager → `firestore-send-email-SMTP_PASSWORD` → **New version**.
   - `firebase functions:secrets:set` can't update this secret, because of its lowercase name.
3. In `extensions/firestore-send-email.env`, change `/versions/N` to the new version number.
4. Run `firebase deploy --only extensions`.
   - The extension locks in the secret version at deploy time, so this step is required.
5. Disable the old version in Secret Manager.

**Checking delivery:**
- Each `mail` document gets a `delivery` field: `state` is `SUCCESS` or `ERROR`, with `error` and `attempts`.
- `535 Incorrect authentication data` means the password is wrong.
- cPanel can also limit how many emails an account sends per hour.

## Importing data from the old Windows app

`scripts/import-db.mjs` copies the old `data/db.json` into Firestore. It keeps staff QR tokens, so cards printed from the old app keep their tokens, though their link points at the old server. It also uploads any receipt and odometer photos.

```bash
node scripts/import-db.mjs --key path/to/service-account.json --db path/to/data/db.json --dry-run   # check first
node scripts/import-db.mjs --key path/to/service-account.json --db path/to/data/db.json
node scripts/import-db.mjs --key path/to/service-account.json          # fresh start: staff + admin/SPC only
```

- **Passwords:** every imported account gets a new temporary password, written to `data/firebase-temp-passwords.csv`. Hand them out, then **delete the file**.
- **Re-running:** the script writes with merge, but it gives every account a new temporary password each time, so don't re-run it casually.

## Accounts and access

- **App accounts:**
  - Drivers are created on the Drivers page.
  - Office accounts (admin, SPC) are created by an admin or super user through the `accountSave` function (the User accounts page is on the roadmap).
  - Only a super user can create another super user.
- **Developers:** add them as Firebase project members (Project settings → Users and permissions), and as GitHub collaborators.
- **QR cards:** printed from Staff & QR. They link to `publicBaseUrl` from `settings/app`, or to the address the admin is using if that isn't set. Set `publicBaseUrl` before printing if a custom domain is added.

## Custom domain (optional)

1. Go to Hosting → **Add custom domain**, for example `fleet.spinkano.com.ng`, and add the DNS records it shows at the domain host.
2. Set `publicBaseUrl` in `settings/app` to the new address, so emails and QR cards use it.
3. Reprint the QR cards.

## Backups

Firestore has no automatic backup on this project yet.
- **Recommended:** turn on **scheduled backups** in Firebase console → Firestore → Disaster recovery, keeping them daily for 7–14 days. Alternatively, set up a scheduled `gcloud firestore export` to a Storage bucket.
- **Storage files:** these can be copied with `gsutil -m cp -r`.

## Costs

For a fleet this size, usage normally stays within the free allowance on Blaze. Things that cost money, if any:
- Cloud Functions running
- Firestore reads, mostly from the live office screens
- Storage for photos
- Container images, which have a cleanup policy deleting images older than one day

Watch the Billing page for the first months.

## Local development and emulators

`npm --prefix web run dev` runs the web app against the **live** project.

The Firebase emulators (`firebase emulators:start`, configured in `firebase.json`) need Java 11+.
- To point the web app at them, set `VITE_USE_EMULATORS=true` (see `web/src/firebase.ts`).
- The emulators keep separate, empty data, which is good for risky experiments.
