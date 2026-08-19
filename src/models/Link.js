const mongoose = require('mongoose');

const LinkSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true
  },
  link: {
    type: String,
    required: true
  },
  alias: {
    type: String,
    required: true
  },
  deskripsi: {
    type: String,
    default: ''
  },
  referer: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    default: ''
  },
  status: {
    type: Boolean,
    default: true
  },
  dateExpired: {
    type: String,
    default: ''
  },
  favicon: {
    type: String,
    default: ''
  },
  qrCode: {
    type: String,
    default: ''
  },
  segmen: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Segmen',
    default: null
  },
  updateBy: {
    type: String,
    default: ''
  },
  clicks: {
    type: Number,
    default: 0
  },
  updateAt: {
    type: Date,
    default: Date.now
  },
  timeStamp: {
    type: Date,
    default: Date.now
  }

});

LinkSchema.index({ user_id: 1, alias: 1 });
LinkSchema.index({ alias: 1 });

const Link = mongoose.model('Link', LinkSchema);

module.exports = Link;
