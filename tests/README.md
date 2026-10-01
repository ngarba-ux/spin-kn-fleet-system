# Tests

End-to-end tests that run against the **live** Firebase project `spin-kn-fleet`.
- They create throwaway accounts (`…@example.invalid`), vehicles, staff and requests.
- They check results through the real app and functions.
- Then they **delete everything they created**, and restore the request counter.

| Script | What it checks | Takes |
|---|---|---|
| `e2e/api-workflow.cjs` | Staff portal, security rules, the full request workflow, the driver queue (start, wrong odometer rejected, end), status page | ~1 min |
| `e2e/api-fleet.cjs` | Vehicles, drivers (vehicle moves, deactivate, password reset), staff and QR (revoke, regenerate) | ~1 min |
| `e2e/ui-main-flow.cjs` | In Chrome: sign-in and first password, vehicles, drivers, staff and QR printing, staff request from a phone, admin → SPC → driver → completed | ~3 min |
| `e2e/ui-operations.cjs` | In Chrome: tasks, the driver on the road, trips (office ends a trip), fuel with receipt upload, SPC read-only | ~3 min |
| `e2e/ui-super-user.cjs` | Super-user powers, the two-person check, protection of super accounts, and the matching screens | ~2 min |

## Running them

1. Get a **service-account key** for `spin-kn-fleet` (Firebase console → Project settings → Service accounts → Generate new private key). Keep it outside the repository.
2. Install Chrome or Edge, and make sure `functions/` and `web/` have their dependencies installed (`npm --prefix functions install`, `npm --prefix web install`).
3. Install the test runner, set the key path, and run:

```bash
npm --prefix tests/e2e install

# macOS / Linux / Git Bash
export SPIN_SERVICE_ACCOUNT=/path/to/spin-kn-fleet-key.json
# PowerShell
$env:SPIN_SERVICE_ACCOUNT = 'C:\keys\spin-kn-fleet-key.json'

npm --prefix tests/e2e run api        # API tests
npm --prefix tests/e2e run ui         # browser tests
node tests/e2e/ui-operations.cjs      # or a single test
```

Set `CHROME_PATH` if Chrome or Edge isn't in a standard location. Screenshots from the browser tests are saved in `tests/e2e/shots*/`, which git ignores.

## Rules for writing tests

- **Use `@example.invalid` emails** for every account you create. Cleanup relies on it.
- **Never email real people.**
  - Tests that submit or forward requests must pause the real office accounts first: set their `users` `status` to `inactive`, which only affects who gets email, not sign-in.
  - Restore them in `cleanup()`. The existing tests show how.
  - Test staff members get `email: null`.
- **Always clean up in a `finally` block,** even when the test fails. Check that the leftover counts printed at the end are back to the real data.
- **Wait for live updates** (`waitForFunction` for some text) instead of fixed sleeps. Firestore updates arrive asynchronously.
- **Don't run tests while real users are working** if you can avoid it: they briefly appear in the live lists.
