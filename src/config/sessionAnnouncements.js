'use strict';

// A single SESSION_HUB_CHANNEL_ID can replace separate Interview/Training/Mass Shift channels.
const HUB_CHANNEL_ID = process.env.SESSION_HUB_CHANNEL_ID || null;
const HUB_PING_ROLE_ID = process.env.SESSION_HUB_PING_ROLE_ID || null;

const SESSION_CONFIG = {
  interview: {
    channelId: process.env.SESSION_INTERVIEW_CHANNEL_ID || HUB_CHANNEL_ID,
    pingRoleId: process.env.SESSION_INTERVIEW_PING_ROLE_ID || HUB_PING_ROLE_ID,
  },
  training: {
    channelId: process.env.SESSION_TRAINING_CHANNEL_ID || HUB_CHANNEL_ID,
    pingRoleId: process.env.SESSION_TRAINING_PING_ROLE_ID || HUB_PING_ROLE_ID,
  },
  mass_shift: {
    channelId: process.env.SESSION_MASS_SHIFT_CHANNEL_ID || process.env.SESSION_MASSSHIFT_CHANNEL_ID || HUB_CHANNEL_ID,
    pingRoleId: process.env.SESSION_MASS_SHIFT_PING_ROLE_ID || process.env.SESSION_MASSSHIFT_PING_ROLE_ID || HUB_PING_ROLE_ID,
  },
};

const QUEUE_CONFIG = {
  interview: {
    channelId: process.env.QUEUE_INTERVIEW_CHANNEL_ID || SESSION_CONFIG.interview.channelId,
    pingRoleId: process.env.QUEUE_INTERVIEW_PING_ROLE_ID || SESSION_CONFIG.interview.pingRoleId,
  },
  training: {
    channelId: process.env.QUEUE_TRAINING_CHANNEL_ID || SESSION_CONFIG.training.channelId,
    pingRoleId: process.env.QUEUE_TRAINING_PING_ROLE_ID || SESSION_CONFIG.training.pingRoleId,
  },
  mass_shift: {
    channelId: process.env.QUEUE_MASS_SHIFT_CHANNEL_ID || process.env.QUEUE_MASSSHIFT_CHANNEL_ID || SESSION_CONFIG.mass_shift.channelId,
    pingRoleId: process.env.QUEUE_MASS_SHIFT_PING_ROLE_ID || process.env.QUEUE_MASSSHIFT_PING_ROLE_ID || SESSION_CONFIG.mass_shift.pingRoleId,
  },
};

module.exports = { SESSION_CONFIG, QUEUE_CONFIG };
