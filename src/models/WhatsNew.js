const mongoose = require('mongoose');

const WhatsNewSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['added', 'updated', 'removed'],
    default: 'added',
  },
  version: {
    type: String,
    default: '',
    trim: true,
  },
  tags: {
    type: [String],
    default: [],
  },
  createdBy: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

const WhatsNew = mongoose.model('WhatsNew', WhatsNewSchema);

module.exports = WhatsNew;
