const mongoose = require('mongoose');

const StatSchema = new mongoose.Schema({
  alias: {
    type: String,
    required: true
  },
  userID: {
    type: String,
    required: true
  },
  linkID: {
    type: String,
    required: true
  },
  ip: {
    type: String,
    required: true
  },
  negara: {
    type: String,
    required: true
  },
  kota: {
    type: String,
    required: true
  },
  referer: {
    type: String,
    required: true
  },
  os: {
    type: String,
    required: true
  },
  browser: {
    type: String,
    required: true
  },
  browserVersion: {
    type: String,
    required: true
  },
  bahasa: {
    type: String,
    default: ''
  },
  timeStamp: {
    type: Date,
    default: Date.now
  }
});

StatSchema.index({ userID: 1, timeStamp: -1 });
StatSchema.index({ linkID: 1, timeStamp: -1 });
StatSchema.index({ alias: 1, timeStamp: -1 });

const Stat = mongoose.model('Stat', StatSchema);

module.exports = Stat;
