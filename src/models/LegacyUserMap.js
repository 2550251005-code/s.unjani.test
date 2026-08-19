const mongoose = require('mongoose');

const LegacyUserMapSchema = new mongoose.Schema(
  {
    legacyUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ssoUserId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    nomorInduk: {
      type: String,
      default: '',
      trim: true,
    },
    source: {
      type: String,
      default: 'migration',
      trim: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'legacy_user_maps',
  },
);

module.exports = mongoose.model('LegacyUserMap', LegacyUserMapSchema);
