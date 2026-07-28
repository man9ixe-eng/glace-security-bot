# Five-Hour Glace Migration Checklist

## Hour 1 — Deploy safely

- Back up the old project and current environment variables.
- Upload this project to GitHub/your host.
- Add a persistent disk and set `DATA_DIR`.
- Add the exact Corporate Board role IDs.
- Run `npm ci` and `npm test`.

## Hour 2 — Website login

- Add the `/ops/callback` redirect in the Discord Developer Portal.
- Set `PUBLIC_BASE_URL`, `DISCORD_CLIENT_SECRET`, and `OPS_REDIRECT_URI`.
- Start the bot and open `/health`.
- Test `/ops` as Senior Management, Corporate, and Corporate Board.

## Hour 3 — Reduced channels

Create or select:

- Glace Staff Hub panel
- Current LOAs
- Staff schedule/updates (one or two channels)
- Session hub
- Session logs
- Operations log
- Optional ticket panel

Add their IDs to the environment and restart once.

## Hour 4 — Workflow tests

- Use `/opspanel`.
- Create one routine website staff warning.
- Create one website suspension and approve it with Board access.
- Add, extend, and remove a test LOA.
- Publish a test schedule/update.
- Run a safe activity-view command and verify records remain intact.

## Hour 5 — Switch over

- Lock old documentation/punishment channels to read-only.
- Post the Glace Staff Hub panel for the Corporate team.
- Tell Senior Management that website access is view-only.
- Tell Corporate that routine records and posts move to the website.
- Tell Corporate Board that serious actions require their website decision.
- Keep the old channels archived for at least one review cycle before deleting them.
