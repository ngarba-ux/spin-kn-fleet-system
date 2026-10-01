# Contributing to SPIN-KN Fleet

This guide is for developers joining the project. It covers getting access, setting up, the Git workflow, how to build a feature, testing, and deploying. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## 1. Get access

The code and the running app are owned by different people, so ask each one:

| Access | Who grants it, and how | Needed for |
|---|---|---|
| **GitHub** collaborator on `ngarba-ux/spin-kn-fleet-system` | **Nura Garba** (`ngarba-ux`), the repository owner: GitHub → repo → Settings → Collaborators | Pull and push branches, open pull requests |
| **Firebase** project member on `spin-kn-fleet` | **Ahmad Isah** (ahmanur@gmail.com), the Firebase project owner: Firebase console → Project settings → Users and permissions → Add member. Use **Editor** to deploy, **Viewer** to look only | `firebase deploy`, logs, console |
| **An app account** | A super user or admin (Drivers page for drivers; accounts for office users) | Signing in to test |

| Person | Role on the project |
|---|---|
| **Nura Garba** (`ngarba-ux`) | Owns the GitHub repository. Reviews and merges pull requests into `main` |
| **Ahmad Isah** (`ahmanur`, ahmanur@gmail.com) | Collaborator on GitHub. Owns the Firebase project `spin-kn-fleet` (billing, deploys, secrets). Super user in the app |

The **service-account key** used by the import script and the tests gives full admin access to the project.
- Each developer should generate their own from Firebase console → Project settings → Service accounts → Generate new private key.
- Keep it **outside the repository**, for example in `C:\keys\` or `~/keys/`.
- Never commit it, email it or paste it into a chat. `.gitignore` blocks common key file names, but don't rely on that.

## 2. Set up your machine

- Node.js **22** or newer and Git.
- The Firebase CLI: `npm i -g firebase-tools`, then `firebase login`.
- Chrome or Edge, for the browser tests.

```bash
git clone https://github.com/ngarba-ux/spin-kn-fleet-system.git
cd spin-kn-fleet-system
git config user.name  "Your Name"
git config user.email "you@example.com"       # an email on your GitHub account
git config pull.rebase true
npm --prefix functions install
npm --prefix web install
```

**Run the web app locally:** `npm --prefix web run dev` serves <http://localhost:5173>. It talks to the **live** Firebase project, so:
- Anything you do there is real data.
- Use throwaway records and delete them afterwards.

> **OneDrive / slow networks:** if the repo is inside a OneDrive folder, or your connection drops downloads, `npm install` can take 15+ minutes. Retry with `--fetch-retries=6 --maxsockets=3`. Better still, keep the repo outside OneDrive.

## 3. Git workflow

- **`main`** is what's deployed or about to be. Don't commit to it directly.
- **Work on a branch** named for the change, such as `feature/settings-page` or `fix/odometer-check`. Start it from the latest `main`. Until the Firebase rebuild is merged, branch from `firebase-rebuild` instead.
  ```bash
  git checkout main && git pull
  git checkout -b feature/settings-page
  ```
- **Commit small, focused changes** with a clear message. Use the imperative mood ("Add settings page", "Fix fuel total") and explain *why* in the body when it isn't obvious.
- **Push and open a pull request:**
  ```bash
  git push -u origin feature/settings-page
  ```
  Then on GitHub, click **Compare & pull request** and fill in the template. Another person reviews before merging; changes to `main` are merged by the repository owner, Nura Garba, unless agreed otherwise.
- **Stay up to date:** run `git pull --rebase origin main` before you push. Fix any conflicts locally.
- **Deploy from `main`** after merging (section 6), unless you've agreed to test a branch live.

## 4. Building a feature end to end

Most features touch the same layers, in this order:

1. **Data shape.** Add fields to `functions/src/models.ts`, and mirror them in `web/src/types.ts`.
2. **Server logic.** Write a callable function in the matching file under `functions/src/` and export it from `index.ts`.
   - Start with `const me = actor(req, 'admin')` (or the roles allowed).
   - Read input only through `new Input(req.data)`.
   - Do all reads, then all writes, inside `db.runTransaction`. Firestore requires reads to come first.
   - Throw readable errors with `fail('failed-precondition', 'Message the user will see')`.
   - Record an activity log entry with `log(tx, me, 'Action', 'detail')`.
3. **Security rules.** If clients read a new collection, add a `match` block to `firestore.rules` (and `storage.rules` for files). The default is deny.
4. **Indexes.** If a query filters and sorts on different fields, add the index to `firestore.indexes.json`.
5. **Screen.** Add or extend a page in `web/src/pages/`.
   - Read data with `useCollection` / `useDocument` (live updates).
   - Make changes with `call('functionName', data)`.
   - Use the shared components in `ui.tsx` (`Card`, `Modal`, `Field`, `Button`, `useAction`).
   - Add the page to `NAV` and to the page switch in `pages/Office.tsx`.
6. **Test.** Type-check, then extend or add a test in `tests/e2e/` (section 5).
7. **Docs.** Update `docs/ARCHITECTURE.md` if you changed the model, the workflow or the permissions, and `docs/ROADMAP.md` when a roadmap item is done.

**Rules to keep:**
- Never let the browser write business data directly. It always goes through a function.
- Keep secrets (QR tokens, passwords) out of documents the office can list, and put them in admin-only collections.
- Every user-facing error should tell the user what to do.
- Never send email to real people from tests. See [tests/README.md](tests/README.md).

## 5. Testing

| Check | Command |
|---|---|
| Type-check the functions | `npm --prefix functions run build` |
| Type-check and build the web app | `npm --prefix web run build` |
| Firestore rules compile | `firebase deploy --only firestore:rules --dry-run` |
| End-to-end tests against the live project | See [tests/README.md](tests/README.md) (`npm --prefix tests/e2e run all`) |

Run the end-to-end tests that cover what you changed before opening a pull request. Put the results in the pull request description.

## 6. Deploying

You need **Editor** access on the Firebase project. Deploy from an up-to-date `main`.

```bash
firebase deploy --only hosting                       # web app only
firebase deploy --only firestore:rules,storage       # security rules only
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions --force
```

- **`--force`** is needed because `onDriverAction` retries on failure, and non-interactive deploys must confirm that.
- **`FUNCTIONS_DISCOVERY_TIMEOUT=120`** avoids a timeout while the CLI loads the code on slow disks. In PowerShell, set it with `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'` first.
- **Changing the email setup** (sender, password version) uses `firebase deploy --only extensions`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#email).
- **After deploying,** open <https://spin-kn-fleet.web.app> and check the screens you changed. Anyone with the app open gets the new version after a refresh.

## 7. Pull request checklist

- [ ] Branch is up to date with `main`.
- [ ] `npm --prefix functions run build` and `npm --prefix web run build` pass.
- [ ] Rules and indexes are updated if the data access changed.
- [ ] End-to-end tests for the affected area pass, or new ones are added.
- [ ] No keys, passwords, `data/` files or `node_modules` are committed.
- [ ] Docs are updated (ARCHITECTURE, ROADMAP, DEPLOYMENT) where relevant.

## 8. Never commit

- Service-account keys, SMTP passwords, `data/` (live database exports, temporary passwords, uploads)
- `node_modules/`, `web/dist/`, `functions/lib/`, `*.tsbuildinfo`, test screenshots

The SMTP password lives only in Google **Secret Manager**. The Firebase **web** config in `web/src/firebase.ts` is public by design and safe to commit.
