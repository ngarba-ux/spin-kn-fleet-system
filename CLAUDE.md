# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## Project

SPIN-KN Fleet: fleet management for SPIN Kano. Staff request vehicles with a QR card; the admin forwards; the SPC approves; drivers record trips on their phones, offline.
- **Live:** https://spin-kn-fleet.web.app
- **Firebase project:** `spin-kn-fleet`, region `europe-west1`

**Work in the Firebase app:** `functions/`, `web/`, `firestore.rules`, `storage.rules`. `server/` and `public/` are the **legacy** Windows app; don't modify them unless asked.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing the data model, the workflow or permissions. [docs/ROADMAP.md](docs/ROADMAP.md) lists what's done and what to build next.

## Commands

```bash
npm --prefix functions run build                 # type-check + compile functions (tsc)
npm --prefix web run build                       # type-check + build web app
npm --prefix web run dev                         # local dev server (talks to the LIVE project)
firebase deploy --only hosting                   # deploy web
firebase deploy --only firestore:rules,storage   # deploy rules
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions --force
firebase deploy --only extensions                # email extension config
npm --prefix tests/e2e run api|ui                # live e2e tests (needs SPIN_SERVICE_ACCOUNT, see tests/README.md)
```

## Conventions

- **All business writes go through callable Cloud Functions.** Clients never write business data directly; the rules deny it.
  - Exceptions: drivers adding to their own `driverActions` and uploading their own photos, and admins writing `settings/app`.
- **Function pattern:**
  - Check the caller with `const me = actor(req, 'admin', ...)` and read input with `new Input(req.data)`.
  - Do the work in `db.runTransaction`, with **all reads before writes**.
  - Signal errors with `fail(code, 'user-readable message')`, and record an activity entry with `log(tx, me, action, detail)`.
  - Queue emails with `notifyStaff` / `notifyOffice` inside the same transaction.
- **Roles live in Auth custom claims:** `role` is one of `admin`, `spc`, `driver` or `super`, plus `mustChangePassword`.
  - `super` passes both admin and SPC checks in `actor()` and in the rules.
  - **Two-person check:** whoever forwarded a request (`forwardedByUid`) can't approve or decline it. Keep it.
- **Timestamps** are ISO UTC strings; dates without a time are `yyyy-MM-dd`. **Driver ids** are their Auth uids (`drivers/{uid}`).
- **Data shapes:** `functions/src/models.ts` is the source of truth; mirror changes in `web/src/types.ts`.
- **Secrets** (QR tokens) live in admin-only collections (`staffSecrets`). Firestore rules can't hide fields.
- **Web:**
  - React + TypeScript + Tailwind v4.
  - Live data comes from `useCollection` / `useDocument`; changes go through `call('fn', data)`.
  - Use the shared components in `ui.tsx`.
  - Add new office pages to `NAV` and the page switch in `pages/Office.tsx`.
- **New query shapes** need an entry in `firestore.indexes.json`. **New collections** need rules in `firestore.rules`.

## Gotchas (learned the hard way)

- **There is no staging.** Tests and `npm run dev` hit the **live** project with real users. Use `@example.invalid` accounts, clean up, and **never send email to real people**: pause real office accounts (`users.status = 'inactive'`) during tests that create notifications, then restore them. See the existing tests.
- **`--force` is required** on non-interactive functions deploys, because `onDriverAction` has a retry policy.
- **`FUNCTIONS_DISCOVERY_TIMEOUT=120`** avoids a code-loading timeout when deploying from slow disks or OneDrive.
- **Changing a password ends the Firebase session.** After `passwordChanged`, the web app signs straight back in (`setFirstPassword` in `auth.tsx`).
- **The email password** is the Secret Manager secret `firestore-send-email-SMTP_PASSWORD`, **pinned** to a version in `extensions/firestore-send-email.env`. Extensions resolve the version at deploy time, and `functions:secrets:set` rejects this lowercase name. The steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#email).
- **Firestore updates arrive asynchronously.** In browser tests, wait for text rather than sleeping.
- **Slow installs:** if the repo is inside OneDrive or the network is flaky, `npm install` can take 15+ minutes. Run it in the background with `--fetch-retries=6 --maxsockets=3`.
- **Lists load the latest 300 documents.** Don't build features that assume the whole collection is in memory.

## Git and collaboration

- Repo: `ngarba-ux/spin-kn-fleet-system`, owned by **Nura Garba**. Ahmad Isah (`ahmanur`) is a collaborator, and owns the Firebase project `spin-kn-fleet`.
- Collaborators work on **feature branches and open pull requests**; never push to `main` directly.
- The Firebase rebuild lives on `firebase-rebuild` until it's merged.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md), and use the PR template in `.github/`.
- **Never commit** service-account keys, `data/` (exports, temporary passwords) or build output.
- Update `docs/ROADMAP.md` when a roadmap item is finished, and `docs/ARCHITECTURE.md` when the model, workflow or permissions change.
