const mongoose = require('mongoose');

const smsHuntSchema = new mongoose.Schema({
  accessId: { type: String, required: true, index: true },
  deviceId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  targetMode: { type: String, enum: ['phone', 'name'], default: 'phone' },
  target: { type: String, required: true, trim: true, maxlength: 160 },
  enabled: { type: Boolean, default: true },
  scheduleOnConnect: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

smsHuntSchema.index({ deviceId: 1, updatedAt: -1 });

module.exports = mongoose.model('SmsHunt', smsHuntSchema);