const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  accessId:  { type: String, required: false, default: '', index: true },
  deviceId:  { type: String, required: false, default: 'global', index: true },
  name:      { type: String, required: true },
  steps:     { type: [mongoose.Schema.Types.Mixed], default: [] },
  scheduleOnConnect: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', taskSchema);
