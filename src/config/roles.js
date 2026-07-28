'use strict';

// Central Glace team-role mapping. Add comma-separated role IDs in Render with
// the matching environment variable name. Existing Glace team IDs are preserved.

function envIds(...names) {
  return names.flatMap((name) => String(process.env[name] || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{10,25}$/.test(id)));
}

function unique(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(String))];
}

module.exports = {
  OWNER_IDS: unique(
    envIds('OWNER_IDS', 'PRESIDENT_USER_IDS'),
    process.env.PRESIDENT_USER_ID ? [process.env.PRESIDENT_USER_ID] : [],
  ),

  JUNIOR_STAFF_ROLE_IDS: unique(
    ['1412715521496846407'],
    envIds('JUNIOR_STAFF_ROLE_IDS'),
  ),

  INTERN_ROLE_IDS: unique(
    ['1412712811695706112'],
    envIds('INTERN_ROLE_IDS', 'INTERN_TEAM_ROLE_IDS'),
  ),

  MANAGEMENT_ROLE_IDS: unique(
    ['1412712793798606960'],
    envIds('MANAGEMENT_ROLE_IDS', 'MANAGEMENT_TEAM_ROLE_IDS'),
  ),

  SENIOR_MANAGEMENT_ROLE_IDS: unique(
    ['1412712773099454495'],
    envIds('SENIOR_MANAGEMENT_ROLE_IDS', 'CORPORATE_INTERN_ROLE_IDS'),
  ),

  CORPORATE_ROLE_IDS: unique(
    ['1412712767907037305'],
    envIds('CORPORATE_ROLE_IDS', 'CORPORATE_TEAM_ROLE_IDS'),
  ),

  CORPORATE_BOARD_ROLE_IDS: unique(
    envIds(
      'CORPORATE_BOARD_ROLE_IDS',
      'BOARD_OF_DIRECTOR_ROLE_IDS',
      'BOARD_OF_DIRECTORS_ROLE_IDS',
      'PRESIDENTIAL_INTERN_ROLE_IDS',
    ),
  ),

  PRESIDENTIAL_ROLE_IDS: unique(
    ['1412712646305779823'],
    envIds('PRESIDENTIAL_ROLE_IDS', 'PRESIDENTIAL_TEAM_ROLE_IDS'),
  ),
};
