const mongoose = require('mongoose');

const SegmenSchema = new mongoose.Schema({
  nama: {
    type: String,
    required: true,
    trim: true,
  },
  unitKerja: {
    type: String,
    required: true,
    trim: true,
  },
  homebase: {
    type: String,
    required: false,
    trim: true,
  },
  subhomebase: {
    type: String,
    required: false,
    trim: true,
  },
  timeUpdate: {
    type: Date,
    default: Date.now,
  },
  timeStamp: {
    type: Date,
    default: Date.now,
  },
  createBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  editBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
});

module.exports = mongoose.model('Segmen', SegmenSchema);
