# Glace Staff Hub v2.6 — Staff Requests, Discord Approvals & Activity

## Staff request center

- Current Leadership Interns+ submit their own LOA and timezone-change requests through Discord or the Staff Hub.
- LOAs must begin on Monday and end on Sunday. The same weekday rule is enforced by both the request form and the existing LOA manager.
- Intern Team, Management, and Senior Management requests route to Corporate+.
- Corporate and Corporate Board requests route to Presidential.
- Nobody can approve their own request.
- Approvals apply the LOA or timezone update, write an internal log, DM the requester, and DM the reviewer a receipt.
- Returned requests can be revised and resubmitted by the original requester.
- Request records and approved timezone profiles use Supabase when connected.

## Promotion approvals

- New promotion submissions are posted in the configured Corporate Board review channel with approval buttons and a link to the Staff Hub.
- Board approval automatically posts the next review message in the Presidential channel.
- If no current Corporate Board members are detected in Discord, the request skips directly to Presidential review.
- Presidential can also use a documented **Approve Now · Skip Board** override.
- Approval buttons work directly in Discord and in the dashboard queue.
- Final approval sends an internal approval log, DMs the Corporate submitter that they may promote, and DMs the approver a receipt.
- Staff Journey posting is disabled. Promotion announcements remain manual until a privacy-safe public format is configured.

## Activity and staff directory

- Activity uses the bot's existing Discord session-log tracker; no second activity database is created.
- Intern+ can view their own current and previous-week quota progress.
- Corporate+ can view the LI+ activity directory.
- The Staff List reads current Intern+ Roblox community roles using `ROBLOX_GROUP_ID`, maps ranks into Glace teams, and attempts to match Roblox users to Discord members.

## Supabase

Run both SQL files in the Supabase SQL Editor:

1. `supabase/glace_promotions.sql`
2. `supabase/glace_staff_requests.sql`

Keep the Supabase secret/service-role key only in Render environment variables. Never place it in GitHub or client-side code.
