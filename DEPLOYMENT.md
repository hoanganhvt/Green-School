# SMARTTRASHBIN — 29/10/2026

Live site: https://smarttrashbin-98428.web.app/

Project: `smarttrashbin-98428`. Admin username: `ADMIN` (case insensitive). The requested password was provisioned in Firebase Auth, not stored in source files.

Database: `https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app`.

Deployed: Email/Password Auth, Realtime Database Rules, Hosting. Initial cloud data contains admin, settings and BIN-01; no sample students were seeded. Hosting publishes only `public/`, generated from index.html, manifest.webmanifest and assets/. Self-provisioning admin privileges is disabled. Production startup errors no longer silently switch to demo data.

25 unit tests passed. Emulator integration passed after the Rules change: registration, permissions, QR sessions, device events, cooldown and backend scoring without any browser.

Live smoke test passed: HTML and local assets, backend source returns 404, correct admin login, incorrect password rejected, admin role, protected profiles, anonymous write denied, admin bin CRUD and cleanup. Repeat with GS_ADMIN_PASSWORD set temporarily: `node scripts/test-production.cjs`.

Browser visual verification could not run: computer-use stopped because the current Windows browser URL could not be reliably determined. ESP32/USB hardware is untested.

## Outstanding work

Billing is not enabled. Cloud Functions requires Blaze; automatic cloud scoring is NOT deployed or verified. The project owner or billing administrator must link the intended billing account. Charges belong to that billing account, not automatically to the editor/deployer.

After billing is enabled:

```powershell
npx.cmd -y firebase-tools@latest deploy --only functions --project smarttrashbin-98428
```

Then test a dedicated student/device and events through the live database, including aggregate updates and rejection cases, before declaring the complete cloud workflow operational.

The USB bridge is local-only. Cloud hardware integration still needs HTTPS support and a separately provisioned device credential. Never reuse local demo credentials on cloud.

Student-code lookups, bin/session information and transaction history retain the original public-read design. Review privacy requirements before importing real student data. No real student data has been imported.

Local tests explicitly use `demo-green-school`; cloud uses SMARTTRASHBIN. PROJECT_HANDOFF.md remains the architecture/hardware reference; its pre-deployment status is superseded here.
