const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userIdString: {
    type: String
  },
  accessId: {
    type: String,
    index: true,
    default: ''
  },
  deviceName: String,
  model: String,
  manufacturer: String,
  androidVersion: String,
  appVersion: String,
  deviceInfo: mongoose.Schema.Types.Mixed,
  permissions: [{
    name: String,
    granted: Boolean
  }],
  isOnline: {
    type: Boolean,
    default: false
  },
  blocked: {
    type: Boolean,
    default: false,
    index: true
  },
  blockedAt: Date,
  lastSeen: {
    type: Date,
    default: Date.now
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  ipAddress: String,
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  consentGiven: {
    type: Boolean,
    default: false
  },
  consentTimestamp: Date
});

// Keep the dashboard's newest-first list and stale-device sweep indexed.
deviceSchema.index({ lastSeen: -1 });
deviceSchema.index({ isOnline: 1, lastSeen: 1 });

module.exports = mongoose.model('Device', deviceSchema);
