# SMARTTRASHBIN — 29/10/2026

Web: https://smarttrashbin-98428.web.app/
Project: `smarttrashbin-98428`.
Database: `https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app`.

## Current architecture

Hosting, Email/Password Authentication and Realtime Database Rules are deployed.
Admin username is `ADMIN` (case insensitive); the password is in Firebase Auth,
not in source. Hosting publishes only `public/`, generated from the frontend.

Scoring now runs on the laptop using `npm.cmd run backend` and Firebase Admin SDK.
Cloud Functions source/configuration has been removed. Blaze is not required by
this design; the project can remain on Spark within its service quotas.

```text
ESP32 -> USB bridge -> Firebase events/pending
Laptop backend -> atomic scoring transaction -> Firebase -> web realtime
```

`hardware/bin_config.json` identifies the bin. The USB bridge does not use device
email/password. Backend administration uses a service account JSON kept only on
the laptop (`GOOGLE_APPLICATION_CREDENTIALS` in ignored `.env`). User requested
setup instructions are in README. A key is now configured in ignored secrets/;
its contents are not stored in documentation or source.

`backend/scoring.cjs` retains session/user validation, cooldown, event age limits,
duplicate protection and atomic updates to student/class/week/bin/history.
Pending events persist in Firebase; when the backend resumes, stale events over
60 seconds old and expired/mismatched sessions are rejected. Do not promise
point recovery for old drops after a laptop/network outage.

## Production permissions

The bin-ID Rules were deployed with explicit approval for unauthenticated
production event/heartbeat writes on 29/10/2026. They accept new pending events
for existing bins, valid matching student sessions, configured types and valid
timestamps. They deny device writes to points/sessions and event overwrite or
deletion. Individual event lookup is allowed for retry verification; anonymous
listing of all events is denied. Old device accounts/records were not deleted.

A bin ID is an identifier, not authentication: someone who knows bin/session
data can spoof events and heartbeats. Service account keys must never be placed
in frontend assets or public/. The Admin SDK runs only on the trusted laptop.

Database Rules remain at the previously approved release. The laptop migration
frontend was deployed to Hosting version `3a4f3a7c41a9e77a`. Live verification
confirmed the updated frontend matches source and backend/index.cjs,
backend/scoring.cjs, .env and the credential path all return HTTP 404. Earlier
checks confirmed individual event lookup and rejection of anonymous event
listing. This migration does not change Rules or migrate user data.

## Validation and remaining setup

26 Node tests passed. Integration with Auth/Database emulators and the actual
laptop worker passed: no Cloud Functions emulator is used. Checks include rules,
registration, session ownership, event scoring, cooldown, invalid events, and
concurrent workers processing the same event without double credit.

Service account authentication and a read-only pending-event query passed on the
live database (0 pending events at check time). The .env path was corrected to
the existing file in ignored secrets/. No database writes were made; the
user subsequently started the backend and confirmed `Backend ready` against
production. A complete physical drop-to-points flow remains unverified. Run backend until `Backend ready`, then
run the USB bridge and scan the QR before dropping rubbish. Keep both windows
open. Closing the web admin page does not stop scoring; stopping the laptop
backend does. Firmware/camera/USB on real hardware remain untested.

Python bridge tests were updated earlier but were not run in the tool environment
because it has no Python runtime. Camera-to-firmware classification remains a
separate unfinished integration.
