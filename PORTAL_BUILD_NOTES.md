# Glace Hotels Staff Hub — Website Build v2.1

This project now includes the redesigned bright, bubbly, futuristic Glace Hotels Staff Hub at `/ops`.

## What changed

- Brighter responsive login and dashboard with larger typography, full-screen spacing, and clearer navigation.
- Discord OAuth sign-in with a fresh server-role check before every protected API action.
- Dynamic role-colored themes throughout the portal:
  - Intern Team — pink
  - Management — purple
  - Senior Management — green
  - Corporate — red
  - Corporate Board — orange
  - Presidential — yellow/gold
- Leadership Intern+ may sign in, with tabs and data filtered server-side by current rank. Presidential users also receive a read-only Preview As Tier selector for safe testing.
- Promotion Submissions workflow is fully connected to the existing persistent promotion store.
- Watch Records and Restricted Records are now permanent website systems.
- Staff Actions, documents, schedules/updates, current LOAs, LOA history, and audit records remain available in the portal.

## Promotion ownership workflow

1. Corporate completes due diligence.
2. Corporate submits the promotion and becomes its completion owner.
3. Corporate Board approves, returns, or denies it.
4. Presidential gives final approval.
5. Promotions into Corporate Board or Presidential require two distinct Presidential approvals.
6. The original Corporate owner carries out the Discord promotion.
7. The portal checks the candidate’s current Discord tier **and matching rank-role name**.
8. After successful verification, the record becomes Completed and posts to Staff Journey.

Approval does not mark the promotion as complete. Completion is tracked separately.

## Required deployment values

```env
PUBLIC_BASE_URL=https://your-service.onrender.com
DISCORD_CLIENT_SECRET=your_discord_oauth_secret
OPS_REDIRECT_URI=https://your-service.onrender.com/ops/callback
GUILD_ID=your_glace_server_id

INTERN_ROLE_IDS=
MANAGEMENT_ROLE_IDS=
SENIOR_MANAGEMENT_ROLE_IDS=
CORPORATE_ROLE_IDS=
CORPORATE_BOARD_ROLE_IDS=
PRESIDENTIAL_ROLE_IDS=

STAFF_JOURNEY_CHANNEL_ID=
OPERATIONS_LOG_CHANNEL_ID=
# Leave DATA_DIR unset on free Render unless a disk is actually mounted.
```

In the Discord Developer Portal, add the exact OAuth redirect URL shown above.

## Important role-name verification note

The final completion check compares the proposed rank text to the candidate’s normalized Discord role names. Enter the actual rank name in the submission, such as `Supervisor`, `Executive Manager`, or `Board of Director`. Emojis and decorative punctuation in the Discord role are ignored during matching.

## Run

```bash
npm ci
npm test
npm run deploy-commands
npm start
```

Then open `/ops` or post the portal button with `/opspanel`.


## v2.1 interface changes

- Removed visible OPS I/II/III/IV/V naming. The portal now uses Intern Team, Management, Senior Management, Corporate, Corporate Board, and Presidential.
- The logged-in tier controls the portal accent theme automatically.
- Presidential accounts can preview every tier’s navigation and interface. Preview mode locks forms and record actions.
- Dashboard cards, navigation, forms, records, and text are larger and easier to scan.
- The dashboard uses fewer columns at normal desktop widths so cards no longer appear tiny.
- Session diagnostics accept either one shared session hub or the three separate interview/training/mass-shift channels.
