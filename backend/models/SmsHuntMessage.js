const mongoose = require('mongoose');

const smsHuntMessageSchema = new mongoose.Schema({
  accessId: { type: String, required: true, index: true },
  deviceId: { type: String, required: true, index: true },
  huntIds: { type: [String], default: [] },
  smsId: { type: String, default: '' },
  messageKey: { type: String, required: true },
  sender: { type: String, default: '' },
  senderName: { type: String, default: '' },
  body: { type: String, default: '' },
  date: { type: Number, default: Date.now },
  receivedAt: { type: Date, default: Date.now },
});

smsHuntMessageSchema.index({ deviceId: 1, messageKey: 1 }, { unique: true });
smsHuntMessageSchema.index({ deviceId: 1, receivedAt: -1 });

module.exports = mongoose.model('SmsHuntMessage', smsHuntMessageSchema);