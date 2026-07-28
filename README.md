# Glace Security Bot — Reorganized Build

This build keeps Discord focused on **live operations** while moving permanent staff documentation into the private, redesigned **Glace Management Portal** at `/ops`.

## What is included

- Existing moderation, tickets, sessions, activity, Trello, Staff Journey, ban appeals, and LOA features.
- A private Discord OAuth website for staff actions, approval decisions, documents, schedules, updates, active LOAs, LOA history, and audits.
- One central permission matrix for all 47 slash commands.
- The complete eight-tier rank ladder and five Ops access groups.
- A single combined Operations Log option instead of many separate log channels.
- Persistent JSON storage through `DATA_DIR`, with automatic first-boot copying of existing bundled records.
- Safe command loading, startup diagnostics, health endpoint, audit trail, and graceful shutdown.

## Access model

| Ops | Team | Internal tier | Website access |
|---|---|---:|---|
| Ops 1 | Intern + Management | 3–4 | Sign in; view rank-appropriate dashboard, posts, LOAs, and available documents |
| Ops 2 | Senior Management | 5 | View staff actions and expanded internal documentation |
| Ops 3 | Corporate | 6 | Submit promotions after due diligence; carry out approved promotions; manage routine actions, watch records, documents, schedules, and updates |
| Ops 4 | Corporate Board | 7 | Review promotion submissions, approve serious staff actions, manage restricted records, reassign promotion completion, and view audits |
| Ops 5 | Presidential | 8 | Final promotion approval and highest portal authority |

`Corporate Intern` remains Senior Management. `Presidential Intern` remains Corporate Board.

## Recommended Discord channel layout

You no longer need a separate log or documentation channel for every action. A clean setup is:

1. `#staff-operations` — `/opspanel` website button and other permanent panels
2. `#current-loas` — `/addloa`, `/extendloa`, and `/removeloa` maintain the current display
3. `#staff-schedule` — current weekly schedule, or combine this with staff updates
4. `#staff-updates` — promotions and important staff announcements
5. `#session-hub` — current session announcements and queue panels
6. `#session-logs` — completed session/activity source of truth
7. `#operations-log` — one private audit feed for important bot and website actions
8. Optional `#ticket-panel` and the existing private ban-appeal review channel

Set `STAFF_POSTS_CHANNEL_ID` to use one channel for both schedules and updates.

## Fast deployment order

### 1. Preserve your current environment values

Do **not** delete your current Render variables. Keep the Trello IDs, role IDs, ticket IDs, and appeal settings you already use. Add the new values from `.env.example`.

Never upload or share your real bot token, Discord client secret, Trello token, or API keys.

### 2. Add a persistent data folder

Set:

```env
DATA_DIR=/var/data/glace
```

That folder must be mounted to persistent storage by your host. Without persistent storage, website cases, LOA history, activity data, warnings, queues, and audit records can disappear on a redeploy.

On first boot, the bot copies existing bundled JSON records into the persistent folder when the destination file does not exist.

### 3. Configure Discord OAuth

In the Discord Developer Portal for this bot application, add this redirect URL:

```text
https://YOUR-BOT-DOMAIN/ops/callback
```

Then set:

```env
PUBLIC_BASE_URL=https://YOUR-BOT-DOMAIN
DISCORD_CLIENT_SECRET=YOUR_CLIENT_SECRET
OPS_REDIRECT_URI=https://YOUR-BOT-DOMAIN/ops/callback
```

The website only asks Discord for identity. It then checks the user’s current role inside `GUILD_ID` before allowing access.

### 4. Configure the access roles

At minimum, set the exact IDs for:

```env
INTERN_ROLE_IDS=
MANAGEMENT_ROLE_IDS=
SENIOR_MANAGEMENT_ROLE_IDS=
CORPORATE_ROLE_IDS=
CORPORATE_BOARD_ROLE_IDS=
PRESIDENTIAL_ROLE_IDS=
```

Comma-separate multiple team/rank roles. The bot has role-name fallback, but exact IDs are safer. Corporate Board must be configured because the old bot skipped it as a central tier.

### 5. Configure the reduced channels

```env
OPERATIONS_LOG_CHANNEL_ID=
CURRENT_LOAS_CHANNEL_ID=
STAFF_SCHEDULE_CHANNEL_ID=
STAFF_UPDATES_CHANNEL_ID=
SESSION_HUB_CHANNEL_ID=
SESSION_LOG_CHANNEL_ID=
```

The old `LOA_LOG_CHANNEL_ID` remains supported. Ticket types can all share one `TICKET_PANEL_CHANNEL_ID` and one `TICKET_LOG_CHANNEL_ID`.

### 6. Install, validate, deploy commands, and start

```bash
npm ci
npm test
npm run deploy-commands
npm start
```

`npm test` must finish with `Glace Security Bot validation passed.`

After the bot is online, use `/opspanel` in `#staff-operations`. Open `/health` on the public service URL to view non-secret configuration readiness.

## Management Portal behavior

- **Leadership Intern+:** may sign in. The server only returns tabs and records allowed by the member’s current Discord tier.
- **Senior Management:** can view formal staff-action records.
- **Corporate:** creates routine staff actions, watch records, documents, schedules/updates, and fully investigated promotion submissions.
- **Corporate Board+:** decides serious actions, reviews promotion submissions, manages restricted records, and sees protected audit history.
- **Presidential:** provides final promotion approval. Standard promotions need one distinct Presidential approval; Corporate Board/Presidential promotions need two distinct approvals.
- The original Corporate submitter remains the promotion completion owner unless Board+ records a reassignment.
- Approval and completion are separate. After carrying out the promotion, the Corporate owner uses **Verify & Complete**. The portal checks both the candidate’s Discord tier and a normalized role-name match before posting the Staff Journey announcement.
- Serious actions remain `pending_approval` until Corporate Board acts.
- Website schedules and updates are saved permanently and sent to their configured Discord channel.
- `/addloa` remains the live Discord action. Its active record and ended history automatically appear on the website.

The website is the permanent **record, approval, and completion-tracking layer**. It does not silently grant powerful Discord roles; the responsible Corporate member carries out the approved promotion first, and the portal verifies it afterward.

## Important safety behavior

- Every slash command is blocked unless it exists in `src/config/access.js`.
- Powerful commands now use one rank check instead of separate contradictory checks.
- Corporate Board is its own tier.
- Promotion, resignation, moderation, demotion, and website staff-action targets are protected by hierarchy checks where a Discord target is available.
- Missing optional ticket, Trello, appeal, or website configuration no longer crashes the entire bot.
- Successful high-impact commands, denied attempts, and failures are saved to the audit. Only important actions are mirrored into `#operations-log`, preventing log spam.
- The bot no longer prints any token information.

## Health check

Open:

```text
https://YOUR-BOT-DOMAIN/health
```

The response shows whether the Discord client is ready and which optional systems still need environment values. It never returns secrets.

## Before deleting old Discord channels

Keep the old channels read-only until you have:

1. Confirmed `/ops` login works for each Ops group.
2. Confirmed a test staff warning appears on the website.
3. Confirmed a serious test action requires Board approval.
4. Confirmed `/addloa`, `/extendloa`, and `/removeloa` update `#current-loas` and website history.
5. Confirmed schedules/updates post to the intended channel.
6. Confirmed `#session-logs` still drives activity correctly.
7. Backed up any old evidence or records that are not already in Trello/data files.

Then archive or delete the old documentation and punishment-log channels.
