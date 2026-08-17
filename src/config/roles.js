'use strict';

// Central Glace Discord role mapping.
// Hard-coded IDs are the current production roles supplied by Mani.
// Environment variables remain supported as fallbacks/overrides for future migrations.

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

  // Community access role. Members receive this automatically 24 hours after
  // their Discord join timestamp. This is separate from Bloxlink/staff syncing.
  GLACE_FAMILY_ROLE_IDS: unique(
    ['1493832890734088303'],
    envIds('GLACE_FAMILY_ROLE_ID', 'GLACE_FAMILY_ROLE_IDS'),
  ),

  // ---------------------------
  // Individual Bloxlink ranks
  // ---------------------------
  SECURITY_ROLE_IDS: unique(
    ['1036289077496004679'],
    envIds('SECURITY_ROLE_ID', 'SECURITY_ROLE_IDS'),
  ),
  CUSTODIAN_ROLE_IDS: unique(
    ['1036289075809886379'],
    envIds('CUSTODIAN_ROLE_ID', 'CUSTODIAN_ROLE_IDS'),
  ),
  HOTEL_COOK_ROLE_IDS: unique(
    ['1036289074744541234'],
    envIds('HOTEL_COOK_ROLE_ID', 'HOTEL_COOK_ROLE_IDS'),
  ),
  FRONT_DESK_ROLE_IDS: unique(
    ['1036289073427521617'],
    envIds('FRONT_DESK_ROLE_ID', 'FRONT_DESK_ROLE_IDS'),
  ),

  LEADERSHIP_INTERN_RANK_ROLE_IDS: unique(
    ['1036289072454438962'],
    envIds('LEADERSHIP_INTERN_ROLE_ID', 'LEADERSHIP_INTERN_ROLE_IDS', 'LEADERSHIP_INTERN_RANK_ROLE_ID'),
  ),

  SUPERVISOR_ROLE_IDS: unique(
    ['1036289071259062314'],
    envIds('SUPERVISOR_ROLE_ID', 'SUPERVISOR_ROLE_IDS'),
  ),
  ASSISTANT_MANAGER_ROLE_IDS: unique(
    ['1036289070336323604'],
    envIds('ASSISTANT_MANAGER_ROLE_ID', 'ASSISTANT_MANAGER_ROLE_IDS'),
  ),
  HOTEL_MANAGER_ROLE_IDS: unique(
    ['1036289069266780221'],
    envIds('HOTEL_MANAGER_ROLE_ID', 'HOTEL_MANAGER_ROLE_IDS'),
  ),

  EXECUTIVE_MANAGER_ROLE_IDS: unique(
    ['1036289067987513506'],
    envIds('EXECUTIVE_MANAGER_ROLE_ID', 'EXECUTIVE_MANAGER_ROLE_IDS'),
  ),
  CORPORATE_INTERN_RANK_ROLE_IDS: unique(
    ['1036289067182207008'],
    envIds('CORPORATE_INTERN_ROLE_ID', 'CORPORATE_INTERN_RANK_ROLE_ID', 'CORPORATE_INTERN_RANK_ROLE_IDS'),
  ),

  JUNIOR_CORPORATE_ROLE_IDS: unique(
    ['1036289066196537374'],
    envIds('JUNIOR_CORPORATE_ROLE_ID', 'JUNIOR_CORPORATE_ROLE_IDS'),
  ),
  SENIOR_CORPORATE_ROLE_IDS: unique(
    ['1036289065127006309'],
    envIds('SENIOR_CORPORATE_ROLE_ID', 'SENIOR_CORPORATE_ROLE_IDS'),
  ),
  HEAD_CORPORATE_ROLE_IDS: unique(
    ['1036289063809982516'],
    envIds('HEAD_CORPORATE_ROLE_ID', 'HEAD_CORPORATE_ROLE_IDS'),
  ),

  BOARD_OF_DIRECTOR_RANK_ROLE_IDS: unique(
    ['1036289063046619176'],
    envIds('BOARD_OF_DIRECTOR_ROLE_ID', 'BOARD_OF_DIRECTOR_RANK_ROLE_ID', 'BOARD_OF_DIRECTOR_RANK_ROLE_IDS'),
  ),
  PRESIDENTIAL_INTERN_RANK_ROLE_IDS: unique(
    ['1036289062023205015'],
    envIds('PRESIDENTIAL_INTERN_ROLE_ID', 'PRESIDENTIAL_INTERN_RANK_ROLE_ID', 'PRESIDENTIAL_INTERN_RANK_ROLE_IDS'),
  ),

  CHIEF_EXECUTIVE_OFFICER_ROLE_IDS: unique(
    ['1036289060580368458'],
    envIds('CHIEF_EXECUTIVE_OFFICER_ROLE_ID', 'CHIEF_EXECUTIVE_OFFICER_ROLE_IDS', 'CEO_ROLE_ID'),
  ),
  VICE_PRESIDENT_ROLE_IDS: unique(
    ['1036289059858956298'],
    envIds('VICE_PRESIDENT_ROLE_ID', 'VICE_PRESIDENT_ROLE_IDS'),
  ),
  PRESIDENT_ROLE_IDS: unique(
    ['1036289058877481051'],
    envIds('PRESIDENT_ROLE_ID', 'PRESIDENT_ROLE_IDS'),
  ),

  // ---------------------------
  // Automatic team roles
  // ---------------------------
  JUNIOR_STAFF_ROLE_IDS: unique(
    ['1412715521496846407'],
    envIds('JUNIOR_STAFF_ROLE_IDS', 'JUNIOR_STAFF_TEAM_ROLE_IDS'),
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
    envIds('SENIOR_MANAGEMENT_ROLE_IDS', 'SENIOR_MANAGEMENT_TEAM_ROLE_IDS'),
  ),

  CORPORATE_ROLE_IDS: unique(
    ['1412712767907037305'],
    envIds('CORPORATE_ROLE_IDS', 'CORPORATE_TEAM_ROLE_IDS'),
  ),

  CORPORATE_BOARD_ROLE_IDS: unique(
    ['1457201903808282634'],
    envIds('CORPORATE_BOARD_ROLE_IDS', 'CORPORATE_BOARD_TEAM_ROLE_IDS'),
  ),

  PRESIDENTIAL_ROLE_IDS: unique(
    ['1412712646305779823'],
    envIds('PRESIDENTIAL_ROLE_IDS', 'PRESIDENTIAL_TEAM_ROLE_IDS'),
  ),
};
