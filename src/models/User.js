const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const StrukturalJabatanSchema = new mongoose.Schema(
  {
    unitKerja: {
      type: String,
      required: true,
      trim: true,
    },
    homeBase: {
      type: String,
      default: '',
      trim: true,
    },
    subHomeBase: {
      type: String,
      default: '-',
      trim: true,
    },
    jabatan: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const AkademikJabatanSchema = new mongoose.Schema(
  {
    unitKerja: {
      type: String,
      default: '',
      trim: true,
    },
    homeBase: {
      type: String,
      default: '',
      trim: true,
    },
    jabatan: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  applications: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Application' }],
    default: [],
  },
  nomorInduk: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['Tendik', 'Dosen'],
    default: 'Tendik',
  },
  jabatan: {
    struktural: {
      type: StrukturalJabatanSchema,
      default: () => ({}),
    },
    akademik: {
      type: AkademikJabatanSchema,
      default: () => ({}),
    },
  },
  jabatanFungsional: {
    type: String,
    default: '',
    trim: true,
  },
  foto: {
    type: String,
    default: 'avatar-1.jpg',
  },
  forcePasswordReset: {
    type: Boolean,
    default: false,
  },
  twoFA: {
    type: Boolean,
    default: false,
  },
  timeStamp: {
    type: Date,
    default: Date.now,
  },
});

// Hash password only when it is newly set or modified
UserSchema.pre('save', async function encryptPassword(next) {
  try {
    if (!this.role) {
      this.role = this.roleID || 'user';
    }

    if (!this.type) {
      this.type = 'Tendik';
    }

    if (!this.jabatan) {
      this.jabatan = {};
    }

    if (!this.jabatan.struktural) {
      this.jabatan.struktural = {};
    }

    if (!this.jabatan.struktural.unitKerja) {
      const fallbackUnit =
        this.jabatan?.akademik?.unitKerja ||
        this.unitKerja ||
        'Tidak diketahui';
      this.jabatan.struktural.unitKerja = fallbackUnit;
    }

    if (!this.jabatan.struktural.homeBase) {
      const fallbackHomeBase =
        this.homebase ||
        this.jabatan?.akademik?.homeBase ||
        '';
      this.jabatan.struktural.homeBase = fallbackHomeBase;
    }

    if (!this.jabatan.struktural.subHomeBase) {
      this.jabatan.struktural.subHomeBase = '-';
    }

    if (!this.jabatan.struktural.jabatan) {
      this.jabatan.struktural.jabatan = '';
    }

    if (!this.jabatan.akademik) {
      this.jabatan.akademik = {};
    }

    if (!this.jabatan.akademik.unitKerja) {
      this.jabatan.akademik.unitKerja = this.jabatan.struktural.unitKerja || '';
    }

    if (!this.jabatan.akademik.homeBase) {
      this.jabatan.akademik.homeBase = this.jabatan.struktural.homeBase || '';
    }

    if (!this.jabatan.akademik.jabatan) {
      this.jabatan.akademik.jabatan = '';
    }

    if (!this.isModified('password')) return next();

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

UserSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', UserSchema);
