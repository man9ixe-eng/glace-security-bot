# Glace Staff Hub v2.12

## Session timezone correction

- Session card titles keep the exact timezone label entered by the host.
- US labels such as EST, EDT, CST, CDT, MST, MDT, PST, and PDT now behave as the matching local timezone and automatically account for daylight saving time.
- Example: `4:50 PM EST` on August 2 creates a Trello due date that displays as `4:50 PM` on an Eastern-time Trello account instead of `5:50 PM`.
- CET, CEST, GMT, BST, UTC offsets, and IANA timezones remain supported.

## `/addsession` confirmation

The command keeps the original Glace confirmation format:

```text
✅ TRAINING ADDED ✅

Thank you, @User ! Your session information is below:

• Host: HostName
• Date: MM/DD/YYYY
• Time: H:MM:00 AM/PM

Card Link: https://trello.com/c/...
```

## Session queue

- The automatic duplicate 30-minute message is disabled.
- `/sessionqueue` remains the only system responsible for queue notices.

## Manual Junior Staff recovery

- `/manualjuniorlog` requires only the Trello session card link.
- It asks for Junior Staff usernames, optional Roblox IDs, and the role they performed.
- Minutes are no longer requested or tracked.
- Supported roles: Security Helper, Front Desk Helper, Custodian Helper, and Hotel Cook Helper.
- The command searches the Junior Staff log channel for the session card.
- If a matching editable log exists, it adds or updates the manual Junior Staff entries.
- If no matching log exists, it creates a new session log linked to the Trello card.
- Junior Staff activity tracking can read multiple people from the recovered session log.
- Leadership Intern+ activity tracking is not changed.
