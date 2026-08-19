const mongoose = require('mongoose');

const BioLinkSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true
  },
  url: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const BioThemeSchema = new mongoose.Schema({
  preset: {
    type: String,
    enum: ['unjani', 'sunset', 'ocean', 'midnight'],
    default: 'unjani',
  },
  backgroundMode: {
    type: String,
    enum: ['gradient', 'solid'],
    default: 'gradient',
  },
  backgroundSolid: {
    type: String,
    default: '#0a241c',
  },
  gradientFrom: {
    type: String,
    default: '#0f2e25',
  },
  gradientTo: {
    type: String,
    default: '#0a241c',
  },
  buttonColor: {
    type: String,
    default: '#155f49',
  },
  buttonTextColor: {
    type: String,
    default: '#ffffff',
  },
}, { _id: false });

const BioSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  alias: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  logo: {
    type: String,
    default: ''
  },
  links: {
    type: [BioLinkSchema],
    default: []
  },
  theme: {
    type: BioThemeSchema,
    default: () => ({}),
  },
  createdBy: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

const Bio = mongoose.model('Bio', BioSchema);

module.exports = Bio;
