'use strict';

/**
 * Session timezone parsing for Glace Hotels.
 *
 * The Trello card title keeps the time and timezone entered by the host.
 * Only the Trello due-date instant is converted, so the Trello account can
 * display it in its configured Eastern timezone.
 */

const EASTERN_TIME_ZONE = 'America/New_York';
const TRELLO_EASTERN_LABEL = 'EST';

// Glace staff commonly use US abbreviations such as EST/CST/MST/PST year-round.
// Treat those labels as the matching local timezone so daylight-saving time is applied
// to the Trello due date while the card title keeps the exact label they entered.
const FIXED_OFFSET_MINUTES = Object.freeze({
  UTC: 0,
  GMT: 0,
  Z: 0,
  WET: 0,
  WEST: 60,
  BST: 60,
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  MSK: 180,
  TRT: 180,
  GST: 240,
  PKT: 300,
  IST: 330,
  NPT: 345,
  BST_BD: 360,
  MMT: 390,
  ICT: 420,
  WIB: 420,
  HKT: 480,
  SGT: 480,
  MYT: 480,
  PHT: 480,
  WITA: 480,
  AWST: 480,
  JST: 540,
  KST: 540,
  WIT: 540,
  ACST: 570,
  AEST: 600,
  ACDT: 630,
  AEDT: 660,
  NZST: 720,
  NZDT: 780,
  HST: -600,
  AKST: -540,
  AKDT: -480,
  AST: -240,
  ADT: -180,
  NST: -210,
  NDT: -150,
  BRT: -180,
  BRST: -120,
  ART: -180,
  CLT: -240,
  CLST: -180,
  COT: -300,
  PET: -300,
  VET: -240,
  WAT: 60,
  CAT: 120,
  SAST: 120,
  EAT: 180,
});

const IANA_ALIASES = Object.freeze({
  EST: EASTERN_TIME_ZONE,
  EDT: EASTERN_TIME_ZONE,
  ET: EASTERN_TIME_ZONE,
  EASTERN: EASTERN_TIME_ZONE,
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CT: 'America/Chicago',
  CENTRAL: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  MT: 'America/Denver',
  MOUNTAIN: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  UK: 'Europe/London',
  LONDON: 'Europe/London',
});

function normalizeZoneToken(value) {
  return String(value || '')
    .trim()
    .replace(/^\(|\)$/g, '')
    .replace(/\.$/, '')
    .trim();
}

function isValidIanaTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseNumericOffset(token) {
  const compact = token.replace(/\s+/g, '').toUpperCase();
  const match = compact.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

function resolveTimeZone(zoneInput) {
  const raw = normalizeZoneToken(zoneInput);
  if (!raw) return null;

  const numericOffset = parseNumericOffset(raw);
  if (numericOffset !== null) {
    return { kind: 'fixed', offsetMinutes: numericOffset, inputLabel: raw.toUpperCase() };
  }

  const upper = raw.toUpperCase().replace(/[.\s-]/g, '_');
  if (Object.prototype.hasOwnProperty.call(IANA_ALIASES, upper)) {
    return { kind: 'iana', timeZone: IANA_ALIASES[upper], inputLabel: upper };
  }
  if (Object.prototype.hasOwnProperty.call(FIXED_OFFSET_MINUTES, upper)) {
    return {
      kind: 'fixed',
      offsetMinutes: FIXED_OFFSET_MINUTES[upper],
      inputLabel: upper,
    };
  }
  if (isValidIanaTimeZone(raw)) {
    return { kind: 'iana', timeZone: raw, inputLabel: raw };
  }

  return null;
}

function parseDateParts(dateInput) {
  const raw = String(dateInput || '').trim();
  let year;
  let month;
  let day;

  let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }

  const test = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year)
    || year < 2000
    || year > 2200
    || test.getUTCFullYear() !== year
    || test.getUTCMonth() !== month - 1
    || test.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseTimeAndZone(timeInput) {
  const raw = String(timeInput || '').trim();
  const match = raw.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(?:(AM|PM)\b)?\s*\(?\s*([A-Za-z][A-Za-z0-9_+./:-]{0,63}|(?:UTC|GMT)?[+-]\d{1,2}(?::?\d{2})?)\s*\)?$/i,
  );
  if (!match) return null;

  const hourRaw = Number(match[1]);
  const minute = Number(match[2] || 0);
  const ampm = match[3] ? match[3].toUpperCase() : null;
  const zone = resolveTimeZone(match[4]);
  if (!zone || minute < 0 || minute > 59) return null;

  let hour24;
  if (ampm) {
    if (hourRaw < 1 || hourRaw > 12) return null;
    hour24 = hourRaw % 12;
    if (ampm === 'PM') hour24 += 12;
  } else {
    if (hourRaw < 0 || hourRaw > 23) return null;
    hour24 = hourRaw;
  }

  return { hour24, minute, zone };
}

function format12Hour(hour24, minute) {
  const normalizedHour = ((Number(hour24) % 24) + 24) % 24;
  const hour12 = normalizedHour % 12 || 12;
  const ampm = normalizedHour >= 12 ? 'PM' : 'AM';
  return `${hour12}:${String(Number(minute) || 0).padStart(2, '0')} ${ampm}`;
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return (asUtc - date.getTime()) / 60000;
}

function zonedLocalToUtcMs(year, month, day, hour24, minute, timeZone) {
  const localWallClockUtc = Date.UTC(year, month - 1, day, hour24, minute, 0, 0);
  let utcGuess = localWallClockUtc;

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const offset = getTimeZoneOffsetMinutes(timeZone, new Date(utcGuess));
    const adjusted = localWallClockUtc - offset * 60000;
    if (Math.abs(adjusted - utcGuess) < 1) break;
    utcGuess = adjusted;
  }

  return utcGuess;
}

function getZonedParts(utcMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const values = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour12: Number(values.hour),
    minute: Number(values.minute),
    ampm: String(values.dayPeriod || '').toUpperCase(),
  };
}

function getFixedOffsetParts(utcMs, offsetMinutes) {
  const date = new Date(Number(utcMs) + Number(offsetMinutes) * 60000);
  const hour24 = date.getUTCHours();
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour12: hour24 % 12 || 12,
    minute: date.getUTCMinutes(),
    ampm: hour24 >= 12 ? 'PM' : 'AM',
  };
}

function getPartsForResolvedZone(utcMs, zone) {
  if (!zone) return null;
  if (zone.kind === 'fixed') return getFixedOffsetParts(utcMs, zone.offsetMinutes);
  return getZonedParts(utcMs, zone.timeZone);
}

function getDateDisplayForZone(utcMs, zoneInput) {
  const zone = typeof zoneInput === 'object' ? zoneInput : resolveTimeZone(zoneInput);
  const parts = getPartsForResolvedZone(utcMs, zone);
  if (!parts) return null;
  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}/${parts.year}`;
}

function getEasternParts(utcMs) {
  const parts = getZonedParts(utcMs, EASTERN_TIME_ZONE);
  return {
    ...parts,
    dateDisplay: `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}/${parts.year}`,
    timeDisplay: `${parts.hour12}:${String(parts.minute).padStart(2, '0')} ${parts.ampm} ${TRELLO_EASTERN_LABEL}`,
    label: TRELLO_EASTERN_LABEL,
  };
}

function parseSessionDateTime(dateInput, timeInput) {
  const date = parseDateParts(dateInput);
  const time = parseTimeAndZone(timeInput);
  if (!date || !time) return null;

  const localWallClockUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour24,
    time.minute,
    0,
    0,
  );

  const utcMs = time.zone.kind === 'fixed'
    ? localWallClockUtc - time.zone.offsetMinutes * 60000
    : zonedLocalToUtcMs(
      date.year,
      date.month,
      date.day,
      time.hour24,
      time.minute,
      time.zone.timeZone,
    );

  if (!Number.isFinite(utcMs)) return null;

  const sourceTime = format12Hour(time.hour24, time.minute);
  const sourceDate = `${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}/${date.year}`;

  return {
    utcMs,
    sourceZone: time.zone.inputLabel,
    source: {
      dateDisplay: sourceDate,
      timeDisplay: `${sourceTime} ${time.zone.inputLabel}`,
      clockDisplay: sourceTime,
      zoneLabel: time.zone.inputLabel,
      resolvedZone: time.zone,
    },
    eastern: getEasternParts(utcMs),
  };
}

function supportedTimeZoneSummary() {
  return [
    'US: EST/EDT/ET, CST/CDT/CT, MST/MDT/MT, PST/PDT/PT, AKST/AKDT, HST',
    'Europe: GMT, BST, WET/WEST, CET/CEST, EET/EEST',
    'Global: UTC, IST, JST, KST, AEST/AEDT, ACST/ACDT, AWST, NZST/NZDT and more',
    'Also accepted: UTC offsets such as UTC+2 or GMT-05:00, and IANA zones such as Europe/London',
  ].join('\n');
}

module.exports = {
  EASTERN_TIME_ZONE,
  TRELLO_EASTERN_LABEL,
  FIXED_OFFSET_MINUTES,
  IANA_ALIASES,
  resolveTimeZone,
  parseDateParts,
  parseTimeAndZone,
  parseSessionDateTime,
  format12Hour,
  getZonedParts,
  getDateDisplayForZone,
  getEasternParts,
  supportedTimeZoneSummary,
};
