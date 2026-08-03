# Glace Staff Hub v2.13

## Manual Junior Log Modal Fix

`/manualjuniorlog` previously failed before opening its modal because the attendee input placeholder exceeded Discord's 100-character modal placeholder limit.

The placeholder is now intentionally short while retaining the required input format:

```text
Username | Roblox ID/N/A | Role
ExampleUser | N/A | Security Helper
```

The command still requires a Trello session card link, uses Junior Staff roles rather than minutes, updates an existing linked session log when possible, and creates a new linked recovery log when no log exists.
