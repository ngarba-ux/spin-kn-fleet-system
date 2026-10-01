# SPIN-KN Fleet

Fleet management for **SPIN Kano** (Sustainable Power and Irrigation for Nigeria, Kano State).

- **Staff** request a vehicle by scanning the QR code on their staff ID card. They don't need an account.
- The **Logistics & Transport office** (admin) reviews each request and forwards it to the **State Project Coordinator (SPC)** for a decision.
- A **driver** and vehicle are assigned. The driver records the trip, stops, fuel and odometer readings on their phone, with or without signal.

**Live app:** <https://spin-kn-fleet.web.app> (Firebase project `spin-kn-fleet`)

## What's in this repository

The repository holds two versions of the app. **New work goes into the Firebase app.**

| Version | Folders | Status |
|---|---|---|
| **Firebase app** (current) | `functions/`, `web/`, `firestore.rules`, `storage.rules`, `extensions/`, `scripts/`, `tests/` | Live; being built out |
| Original Windows app (legacy) | `server/`, `public/`, `start-server.*`, `enable-network-access.bat` | Kept for reference until switchover. See [docs/LEGACY-WINDOWS-APP.md](docs/LEGACY-WINDOWS-APP.md) |

## Quick start for developers

You need:
- Node.js 22 or newer and Git
- The Firebase CLI: `npm i -g firebase-tools`
- Access to the GitHub repository and the Firebase project. See [CONTRIBUTING.md](CONTRIBUTING.md#1-get-access).

```bash
git clone https://github.com/ngarba-ux/spin-kn-fleet-system.git
cd spin-kn-fleet-system
git checkout firebase-rebuild          # until it is merged into main
npm --prefix functions install
npm --prefix web install
firebase login
npm --prefix web run dev               # http://localhost:5173, using the live Firebase project
```

## Documentation

| Document | Read it to… |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | get access, follow the branch and pull-request workflow, add a feature end to end, test and deploy |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | understand the data model, the request workflow, the roles and permissions, and the offline driver queue |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | set up Firebase, deploy, import data, manage email and secrets, and handle backups |
| [docs/ROADMAP.md](docs/ROADMAP.md) | see what is finished, what to build next, and known issues |
| [tests/README.md](tests/README.md) | run the end-to-end tests against the live project |
| [CLAUDE.md](CLAUDE.md) | brief Claude Code (or another AI assistant) working on this repository |

## Tech stack

- **Web:** React 19 + TypeScript + Vite, with Tailwind CSS v4. It's an installable app (PWA) that works offline.
- **Backend:** Cloud Functions for Firebase (2nd gen, Node 22, region `europe-west1`).
- **Data:** Firestore, Firebase Authentication (email and password, with roles stored on each account) and Cloud Storage.
- **Email:** the Firebase **Trigger Email** extension, sending as `fleet@spinkano.com.ng` through the QServers cPanel mail server.
