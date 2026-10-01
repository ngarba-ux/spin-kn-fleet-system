# Roadmap and status

Last updated: 2026-10-01. Update this file when you finish or start something, so the next person knows where things stand.

## Done (live on spin-kn-fleet.web.app)

| Area | What works | Tested by |
|---|---|---|
| Accounts | Sign-in, forced first-password change, roles admin / SPC / driver / **super** (admin + SPC with a two-person check) | `ui-main-flow`, `ui-super-user` |
| Staff QR portal | Look up a card, submit, correct and resubmit, cancel; public status page | `api-workflow`, `ui-main-flow` |
| Trip-request workflow | Acknowledge, review, forward, approve or decline, return, reschedule, assign (with conflict checks and auto-assign), cancel, close; emails at each step | `api-workflow`, `ui-main-flow`, `ui-super-user` |
| Vehicles | Add, edit, condition, record service, service-due and expiry warnings | `api-fleet`, `ui-main-flow` |
| Drivers | Add (temporary password), edit, vehicle assignment, deactivate, reset password | `api-fleet`, `ui-main-flow` |
| Staff & QR | Directory, add, edit, view QR, revoke, regenerate, print one or all cards | `api-fleet`, `ui-main-flow` |
| Tasks | Assign, edit, cancel, overdue and acknowledged flags | `ui-operations` |
| Trips | Live list, detail (map links, stops, photos), office "end trip for driver" | `ui-operations` |
| Fuel & service | Monthly totals, fuel log with receipts, service log, office fuel entry with receipt upload | `ui-operations` |
| Driver app | Tasks, start, stop, resume and end trips, fuel, photos; works offline with an ordered sync queue | `api-workflow`, `ui-main-flow`, `ui-operations` |
| Email | Trigger Email extension through cPanel SMTP as fleet@spinkano.com.ng | manual delivery test |

## Next: missing office screens

Their server functions mostly exist. Each needs a page in `web/src/pages/` and an entry in `NAV` in `pages/Office.tsx`.

1. **User accounts.** List users, add or edit office users (`accountSave`), deactivate (`accountToggle`), reset password (`accountResetPassword`). Only a super user sees the "super" role option.
2. **Settings.** Edit `settings/app`: organisation name, `publicBaseUrl`, service interval, expiry warning days, default origin, project components, vehicle types. Admins can write the document directly (the rules allow it); validate in the form, or add a `settingsSave` function.
3. **Activity log.** List `logs`, newest first, filtered by user and date.
4. **Email log.** List `mail` with its `delivery.state`; a **resend** button (needs a small function that resets `delivery` so the extension retries); a **send test email** button (`emailTest` exists).
5. **Reports.** Trips, km, fuel and cost per vehicle, driver and month; requests per unit and status; CSV export. Large ranges should be computed in a function or paginated, not by loading every document.

## Later

- **Offline photo queue:** photos taken without signal are skipped today. Store them in IndexedDB and upload them later.
- **Backups:** turn on Firestore scheduled backups (see [DEPLOYMENT.md](DEPLOYMENT.md#backups)).
- **Hausa translation:** the legacy app had English and Hausa strings (`public/js/i18n*.js`); bring them across.
- **Push notifications** to drivers for new tasks.
- **Document expiry reminders:** email the office before insurance, roadworthiness or licence documents expire. A scheduled function could do this.
- **App Check** on the public `staffPortal` function, to limit abuse.
- **Code splitting:** the web bundle is about 900 kB, mostly the Firebase SDK; lazy-load office pages.
- **Merge `firebase-rebuild` into `main`**, then remove the legacy app once the office has switched over.

## Known issues and notes

- Tests run against the **live** project, with throwaway `@example.invalid` accounts that they delete. The tests that send notifications pause the real office accounts' email during the run.
- Lists show the most recent 300 records. Older data should be reached through Reports.
- Office screens need a connection to change anything. Drivers can work offline.
- GPS and camera need HTTPS, which Hosting provides. They have only been tested in a desktop browser so far, not on a real phone in the field.
