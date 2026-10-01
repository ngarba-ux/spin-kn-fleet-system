# Architecture

How the Firebase version of SPIN-KN Fleet is put together. Read this before changing the data model, the workflow or the security rules.

## The big picture

```
 Staff phone (QR card, no account)          Office browser (admin / SPC / super)          Driver phone (PWA, offline)
          │ staffPortal (callable)                    │ callables + live Firestore reads              │ writes driverActions/{id}
          ▼                                           ▼                                               ▼
 ┌─────────────────────────────── Cloud Functions (europe-west1) ───────────────────────────────────────────────┐
 │  every write runs in a Firestore transaction · roles from Auth custom claims · emails queued in the same tx  │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │                                   │                                   │
     Firestore                          Cloud Storage                      `mail` collection ──► Trigger Email extension ──► SMTP
 (europe-west1)                       (photos, receipts,                                         (fleet@spinkano.com.ng)
                                       request documents)
```

**Design rules:**
- **Clients can write almost nothing directly.** Every change goes through a Cloud Function, which checks the caller's role, validates input and applies the change in one transaction. If a step fails, nothing changes, including queued emails.
- **The only direct client writes** are drivers adding to their own `driverActions` queue (so it works offline), drivers uploading photos to their own Storage folder, and admins editing `settings/app`.
- **The office screens read live data** with Firestore listeners. There's no polling.

## Code map

```
functions/src/
  index.ts      exports every function; emailTest
  common.ts     setup (region, admin SDK), actor()/role checks, Input validator, time helpers, settings, file upload
  models.ts     Firestore document shapes (the source of truth for fields)
  requests.ts   trip-request workflow: requestAction, checkConflicts, staffPortal (QR portal + status page)
  users.ts      accounts: passwordChanged, accountSave, accountToggle, accountResetPassword, driverSave
  staff.ts      staff directory and QR tokens: staffSave, staffToggle, staffToken
  fleet.ts      vehicleSave, vehicleCondition, vehicleServiced, taskSave, taskCancel, tripForceEnd, fuelAdminAdd
  trips.ts      finishTrip() shared by drivers and the office
  driver.ts     onDriverAction trigger: applies the offline driver queue in order
  notify.ts     email text and recipients (writes to `mail`)

web/src/
  main.tsx      routing: #s=<token> staff portal, #r=<token> status page, #/<page>/<id> signed-in screens
  firebase.ts   Firebase client setup (offline cache on), call() wrapper for functions
  auth.tsx      session + role from custom claims; first-password change
  data.ts       useCollection/useDocument hooks, driver action queue, photo upload, settings
  ui.tsx        shared components (Button, Card, Modal, Field, Badge, Tabs…) and formatters
  print.ts      QR codes and printable staff cards
  types.ts      document shapes as the browser sees them
  pages/        Login, Staff (QR portal + status), Office (shell, dashboard, requests),
                Fleet (vehicles, drivers), People (staff & QR), Ops (trips, tasks, fuel), Driver (phone app)
```

## Roles and permissions

Roles are stored on each Firebase Auth account as **custom claims**: `role` and `mustChangePassword`. Functions check them with `actor(req, ...roles)` in `common.ts`; the rules check them with `request.auth.token.role`.

| Role | Who | Can do |
|---|---|---|
| *(none)* staff | Anyone holding a QR card | Submit, correct and cancel their own trip requests; view a request's status page |
| `driver` | Drivers | See their own tasks, trips and fuel; queue trip and fuel actions; upload their own photos |
| `admin` | Logistics & Transport office | Everything except SPC decisions: requests (acknowledge, review, forward, return, reschedule, assign, cancel, close), fleet, drivers, staff and QR tokens, tasks, fuel, accounts, settings |
| `spc` | State Project Coordinator | Read office data (**not** QR tokens); approve, decline, return or reschedule requests **forwarded to the SPC** |
| `super` | System owner | `admin` + `spc` in one account, with a **two-person check** (below). Only a super user can create, change, reset or deactivate another super user |

**Two-person check:** the forward step records `forwardedByUid`. Whoever forwarded a request can't approve or decline it (`independent()` in `requests.ts`). The web app replaces the buttons with a note. A super user rescheduling a request they forwarded just reschedules it; it doesn't approve it.

**First sign-in:** new accounts get a temporary password and `mustChangePassword: true`.
- **Until it's cleared:** the security rules treat the account as not ready, and `actor()` refuses every function call.
- **Clearing it:** `passwordChanged` sets the new password and clears the flag. Changing the password ends the session, so the web app signs straight back in with the new password.

## Firestore data model

Timestamps are **ISO-8601 UTC strings**, so they sort as text. Dates without a time, such as licence and insurance expiry, use `yyyy-MM-dd`. All field definitions are in `functions/src/models.ts`.

| Collection | Doc id | What it holds |
|---|---|---|
| `settings/app` | fixed | Organisation name, `publicBaseUrl`, service interval, expiry warning days, default origin, project components, vehicle types. Defaults are in `common.ts` / `types.ts` |
| `users/{uid}` | Auth uid | Name, email, role, status (`active`/`inactive`), `mustChangePassword`. Mirrors Auth for listing and email recipients |
| `staff/{id}` | `stf-N` or auto | Staff directory. No credentials |
| `staffSecrets/{staffId}` | same as staff | `qrToken`. **Admin-only**, because a QR token is a credential |
| `drivers/{uid}` | **the driver's Auth uid** | Driver profile, licence, contract, `vehicleId` |
| `vehicles/{id}` | auto | Vehicle details and condition, plus fields kept up to date by functions: `lastOdo`, `activeTripId`, `driverId` |
| `requests/{id}` | auto | Trip request with a copy of the staff member's details, workflow `status`, `history[]`, proposed and assigned driver and vehicle, `statusToken` for the public status page |
| `tasks/{id}` | auto | A job for a driver. Request-linked tasks carry `requestId` and a `requester` summary |
| `trips/{id}` | `t-<actionId>` | A trip started from the driver queue: start and end data, `stops[]`, photo paths |
| `fuel/{id}` | `f-<actionId>` or auto | Fill-ups recorded by drivers or the office, with a receipt path |
| `maintenance/{id}` | auto | Service records |
| `driverActions/{id}` | client-generated | The offline driver queue (below) |
| `mail/{id}` | auto | Outgoing email in Trigger Email format: `to`, `message{subject,text}`, plus `delivery` written by the extension |
| `logs/{id}` | auto | Activity log: who did what |
| `counters/requests` | fixed | `seq` for request numbers `TR-<year>-<000001>` |
| `processed/sub_<id>` | submission id | Stops the same staff form from being submitted twice |

**Indexes** are in `firestore.indexes.json`. Add one there whenever a new query combines filters with ordering on different fields. The deploy prints a link if one is missing.

## Trip-request workflow

```
SUBMITTED ─ack→ ACKNOWLEDGED ─review→ UNDER_ADMIN_REVIEW
    └──────────────── forward (admin) ──────────────────→ FORWARDED_TO_SPC
                                                          ├─approve (SPC)→ APPROVED ─dispatch (admin)→ DRIVER_ASSIGNED ─driver ends trip→ TRIP_COMPLETED ─close→ CLOSED
                                                          │                 (auto-dispatch if a driver was proposed and is still valid)
                                                          ├─reject (SPC)→ REJECTED
                                                          └─return→ RETURNED_FOR_CORRECTION ─staff resubmits→ SUBMITTED
any open status ─cancel (admin, or staff via QR)→ CANCELLED      reschedule: admin any time before the trip starts; SPC = approve with new dates
```

- **One place for every step:** each step is a `case` in `requestAction`. It checks the current status (`requireStatus`), adds a `history` entry (`transition`), updates the request, and queues emails, all in one transaction.
- **Conflict checks** (`conflicts()`): driver or vehicle already committed to another request in the same window; nearby manual tasks; licence expired before the trip ends; contract not active; vehicle off the road.
  - Callers can override a conflict with `force: true`.
  - The app shows the conflicts and a "Continue anyway" button.
- **Assigning a driver** (`planDispatch` + `applyDispatch`) creates the driver's task. The SPC's approval runs the same code automatically when a driver was proposed.

## Offline driver queue

1. Every driver action (`trip.start`, `trip.stop`, `trip.resume`, `trip.end`, `fuel.add`, `task.ack`) is written by the phone as `driverActions/{clientId}`, with `state: 'pending'` and an increasing `seq`.
2. Firestore's offline cache keeps the write on the phone without signal and uploads it later. The UI (`withPending()` in `Driver.tsx`) shows queued actions as if they were already applied.
3. The `onDriverAction` trigger runs `processQueue(driverId)`. It takes that driver's **lowest-`seq` pending action**, applies it in a transaction and marks it `applied`, or `rejected` with an error, then repeats. So a "stop" can never be applied before its "start".
4. **Ids come from the action id** (`t-<id>`, `f-<id>`), so a retry can't create duplicates. The trigger retries infrastructure errors for up to a day.
5. **Photos** upload straight to `uploads/drivers/{uid}/…` (this needs a connection). The action then carries the Storage path.

## Files (Cloud Storage)

| Path | Written by | Readable by |
|---|---|---|
| `uploads/drivers/{uid}/…` | that driver (rules: image or PDF, under 5 MB) | that driver, the office |
| `uploads/office/…` | admin, through `fuelAdminAdd` | the office |
| `uploads/staff/{staffId}/…` | functions only (request documents) | the office |

The web app opens files with `openUpload(path)`, which fetches a download URL.

## Email

- **How it's sent:** functions call `notifyStaff` / `notifyOffice` (`notify.ts`), which add documents to `mail` **inside the same transaction** as the change. The Trigger Email extension sends them over SMTP and writes `delivery.state` back on each document.
- **Who gets them:** office recipients are active users with the matching role, plus `super`.
- **Staff email:** a staff member with no email on record simply gets none.

## Security rules

- `firestore.rules` and `storage.rules` deny everything by default.
- **When you add a collection or a role, update both rules files** and the matching `actor()` checks.
- Firestore rules can't hide individual fields, which is why secrets live in separate collections (`staffSecrets`).
