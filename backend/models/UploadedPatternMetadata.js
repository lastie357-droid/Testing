const mongoose = require('mongoose');

const uploadedPatternMetadataSchema = new mongoose.Schema({
  accessId: {
    type: String,
    default: '',
    index: true,
  },
  deviceId: {
    type: String,
    required: true,
    index: true,
  },
  sourceFileName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255,
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  screenWidth: {
    type: Number,
    required: true,
    min: 1,
    max: 20000,
  },
  screenHeight: {
    type: Number,
    required: true,
    min: 1,
    max: 40000,
  },
}, { timestamps: true });

uploadedPatternMetadataSchema.index(
  { deviceId: 1, accessId: 1, sourceFileName: 1 },
  { unique: true },
);
uploadedPatternMetadataSchema.index({ deviceId: 1, updatedAt: -1 });

module.exports = mongoose.model('UploadedPatternMetadata', uploadedPatternMetadataSchema);
