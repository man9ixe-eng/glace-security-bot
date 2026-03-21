// src/commands/sessions/addsession.js

const { SlashCommandBuilder } = require("discord.js");
const { atLeastTier } = require("../../utils/permissions");
const { createSessionCard } = require("../../utils/trelloClient");

function sanitizeHostName(input) {
  const cleaned = String(input || "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : "Host";
}

function sessionTypeDisplay(sessionType) {
  if (sessionType === "interview") return "INTERVIEW";
  if (sessionType === "training") return "TRAINING";
  return "MASS SHIFT";
}

function sessionTypeBracket(sessionType) {
  if (sessionType === "interview") return "Interview";
  if (sessionType === "training") return "Training";
  return "Mass Shift";
}

function getZoneInfoFromAbbr(tzAbbr) {
  const tz = String(tzAbbr || "").toUpperCase();

  if (["EST", "EDT", "ET"].includes(tz)) {
    return { kind: "iana", timeZone: "America/New_York" };
  }
  if (["CST", "CDT", "CT"].includes(tz)) {
    return { kind: "iana", timeZone: "America/Chicago" };
  }
  if (["MST", "MDT", "MT"].includes(tz)) {
    return { kind: "iana", timeZone: "America/Denver" };
  }
  if (["PST", "PDT", "PT"].includes(tz)) {
    return { kind: "iana", timeZone: "America/Los_Angeles" };
  }

  if (tz === "UTC") return { kind: "fixed", offsetMinutes: 0, label: "UTC" };
  if (tz === "GMT") return { kind: "fixed", offsetMinutes: 0, label: "GMT" };

  return null;
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUtc - date.getTime()) / 60000;
}

function getActualZoneLabel(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  return tzPart ? tzPart.value : timeZone;
}

function zonedLocalToUtcMs(year, month, day, hour24, minute, timeZone) {
  let utcGuess = Date.UTC(year, month - 1, day, hour24, minute, 0, 0);

  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMinutes(timeZone, new Date(utcGuess));
    const adjusted =
      Date.UTC(year, month - 1, day, hour24, minute, 0, 0) -
      offset * 60000;

    if (adjusted === utcGuess) break;
    utcGuess = adjusted;
  }

  return utcGuess;
}

/**
 * Parse:
 * dateStr: MM/DD/YYYY
 * timeStr: HH:MM AM/PM (TIMEZONE)
 *
 * Returns:
 * {
 *   utcMs,
 *   displayHour12,
 *   displayMinute,
 *   displayAmpm,
 *   displayTzLabel
 * }
 */
function parseUserDateTimeToUtcMs(dateStr, timeStr) {
  const date = String(dateStr || "").trim();
  const time = String(timeStr || "").trim();

  const dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return null;

  const [, mmStr, ddStr, yyyyStr] = dateMatch;
  const month = Number(mmStr);
  const day = Number(ddStr);
  const year = Number(yyyyStr);

  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const timeMatch = time.match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(?([A-Za-z]{2,5})\)?$/i
  );
  if (!timeMatch) return null;

  let [, hStr, mStr, ampmRaw, tzRaw] = timeMatch;

  const hour12 = Number(hStr);
  const minute = Number(mStr);
  const ampm = String(ampmRaw).toUpperCase();
  const zoneInfo = getZoneInfoFromAbbr(tzRaw);

  if (
    !Number.isInteger(hour12) ||
    hour12 < 1 ||
    hour12 > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !zoneInfo
  ) {
    return null;
  }

  let hour24 = hour12 % 12;
  if (ampm === "PM") hour24 += 12;

  let utcMs;
  let displayTzLabel;

  if (zoneInfo.kind === "fixed") {
    utcMs =
      Date.UTC(year, month - 1, day, hour24, minute, 0, 0) -
      zoneInfo.offsetMinutes * 60000;
    displayTzLabel = zoneInfo.label;
  } else {
    utcMs = zonedLocalToUtcMs(
      year,
      month,
      day,
      hour24,
      minute,
      zoneInfo.timeZone
    );
    displayTzLabel = getActualZoneLabel(zoneInfo.timeZone, new Date(utcMs));
  }

  return {
    utcMs,
    displayHour12: hour12,
    displayMinute: minute,
    displayAmpm: ampm,
    displayTzLabel,
  };
}

function formatTypedTimeForTitle(parsed) {
  const h = parsed.displayHour12;
  const mm = String(parsed.displayMinute).padStart(2, "0");
  const ampm = parsed.displayAmpm;
  const tz = parsed.displayTzLabel;
  return `${h}:${mm} ${ampm} ${tz}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addsession")
    .setDescription("Create a Trello session card (Interview / Training / Mass Shift).")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Session type.")
        .setRequired(true)
        .addChoices(
          { name: "Interview", value: "interview" },
          { name: "Training", value: "training" },
          { name: "Mass Shift", value: "mass_shift" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription("Date: MM/DD/YYYY")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription('Time: HH:MM AM/PM (TIMEZONE) e.g. "03:00 PM CST"')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("host")
        .setDescription("Host name (letters/numbers ok, emojis removed).")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: "You must be at least **Tier 4 (Management)** to use `/addsession`.",
        ephemeral: true,
      });
    }

    const sessionType = interaction.options.getString("type", true);
    const dateStr = interaction.options.getString("date", true);
    const timeStr = interaction.options.getString("time", true);
    const hostRaw = interaction.options.getString("host", true);

    const parsed = parseUserDateTimeToUtcMs(dateStr, timeStr);
    if (!parsed) {
      return interaction.reply({
        content:
          "Invalid date/time.\n\n" +
          "**Use exactly:**\n" +
          "• Date: `MM/DD/YYYY`\n" +
          "• Time: `HH:MM AM/PM (TIMEZONE)`\n\n" +
          "**Supported TZ:** UTC, GMT, EST/EDT/ET, CST/CDT/CT, MST/MDT/MT, PST/PDT/PT",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const hostName = sanitizeHostName(hostRaw);
      const typedTimeTitle = formatTypedTimeForTitle(parsed);

      const humanBracket = sessionTypeBracket(sessionType);
      const cardName = `[${humanBracket}] ${typedTimeTitle} - ${hostName}`;
      const cardDesc = "** PLEASE JOIN 5-10 MINUTES BEFORE START **";

      const dueISO = new Date(parsed.utcMs).toISOString();

      const result = await createSessionCard({
        sessionType,
        dueISO,
        cardName,
        cardDesc,
      });

      if (!result || !result.ok) {
        return interaction.editReply({
          content:
            "I tried to create the Trello card but something went wrong.\n" +
            "Check Trello env vars + list/label IDs, then try again.",
        });
      }

      const typePretty = sessionTypeDisplay(sessionType);
      const unixSeconds = Math.floor(parsed.utcMs / 1000);

      await interaction.editReply({
        content:
          `✅ **${typePretty} ADDED** ✅\n\n` +
          `Thank you, <@${interaction.user.id}> ! Your session information is below:\n\n` +
          `• Host: ${hostName}\n` +
          `• Date: ${dateStr}\n` +
          `• Time: <t:${unixSeconds}:T>\n\n` +
          `Card Link: ${result.url || "(no link returned)"}`,
      });
    } catch (err) {
      console.error("[ADDSESSION] Unexpected error:", err);
      await interaction.editReply({
        content: "Unexpected error while running `/addsession`. Try again.",
      });
    }
  },
};