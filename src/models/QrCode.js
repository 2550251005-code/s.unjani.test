const mongoose = require('mongoose');

const gradientStopSchema = new mongoose.Schema(
  {
    offset: { type: Number, min: 0, max: 1, default: 0 },
    color: { type: String, trim: true, default: '#111827' },
  },
  { _id: false },
);

const qrCodeOptionsSchema = new mongoose.Schema(
  {
    size: { type: Number, default: 600 }, // output size in px
    resolution: { type: Number, default: 600 }, // for future export needs
    margin: { type: Number, default: 4 },
    errorCorrection: {
      type: String,
      enum: ['L', 'M', 'Q', 'H'],
      default: 'H',
    },
    style: { type: String, default: 'square' }, // main module shape
    innerEyeStyle: { type: String, default: 'square' },
    outerEyeStyle: { type: String, default: 'square' },
    foregroundType: {
      type: String,
      enum: ['color', 'gradient'],
      default: 'color',
    },
    foregroundColor: { type: String, default: '#111827' },
    foregroundGradient: {
      type: {
        type: String,
        enum: ['linear', 'radial'],
        default: 'linear',
      },
      angle: { type: Number, default: 45 },
      stops: { type: [gradientStopSchema], default: undefined },
    },
    backgroundColor: { type: String, default: '#ffffff' },
    backgroundAlpha: { type: Number, min: 0, max: 1, default: 1 },
    frameStyle: { type: String, default: 'none' },
    frameColor: { type: String, default: '#ffffff' },
    frameText: { type: String, default: '' },
    frameTextFont: { type: String, default: 'Inter, Arial, sans-serif' },
    frameTextSize: { type: Number, default: 18 },
    framePadding: { type: Number, default: 16 },
    logoPath: { type: String, default: '' },
    logoSize: { type: Number, default: 0.2 }, // fraction of QR width
    logoMargin: { type: Number, default: 8 },
  },
  { _id: false },
);

const qrCodeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    fileName: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    options: { type: qrCodeOptionsSchema, default: () => ({}) },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
  },
  {
    timestamps: true,
    collection: 'qrcodes',
  },
);

module.exports = mongoose.model('QrCode', qrCodeSchema);
