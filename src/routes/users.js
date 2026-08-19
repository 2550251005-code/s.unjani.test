const express = require('express');
const router = express.Router();

const {
  forwardAuthenticated,
  ensureAuthenticated
} = require('../config/auth');
// Load Controller
const userController = require('../controllers/user')
const qrCodeController = require('../controllers/qrCodeController')
const multer = require('multer');
const path = require('path');
const { resolveFromAssets } = require('../utils/paths');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, resolveFromAssets('uploads'));
  },
  filename: (req, file, cb) => {
    const dateTime = new Date()
      .toISOString()
      .slice(-24)
      .replace(/\D/g, '')
      .slice(0, 14);
    cb(null, file.originalname + dateTime + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    // Perbesar batas field agar data URL preview (base64) tetap diterima
    fieldSize: 8 * 1024 * 1024,
  },
});

const profilePhotoUpload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMime.has((file.mimetype || '').toLowerCase())) {
      return cb(new Error('Foto profil harus berformat JPG, PNG, atau WEBP.'));
    }
    return cb(null, true);
  },
});


// Login Page
router.get('/login', forwardAuthenticated, userController.login);

// Register Page
// router.get('/register', forwardAuthenticated, userController.register);
router.post('/register', userController.doRegister);

// Login
router.post('/login', userController.doLogin);

// Deprecated local password flows (SSO-owned now)
router.get('/force-reset', userController.forceResetView);
router.post('/force-reset', userController.forceResetPassword);
router.post('/changePassword', ensureAuthenticated, userController.updateProfilePassword);
router.post('/changepassword', ensureAuthenticated, userController.updateProfilePassword);
router.post('/changepass', ensureAuthenticated, userController.updateProfilePassword);

// Logout
router.get('/logout', userController.logout);

// Home
router.get('/', ensureAuthenticated, userController.dashboard);

router.get('/dashboard', ensureAuthenticated, userController.dashboard);


// Delete
// router.delete('/delete/:id', userController.delete);

router.get('/links', ensureAuthenticated, userController.links);
router.get('/link/segmen-options', ensureAuthenticated, userController.linkAddSegmenOptions);

// Add Link
router.post('/link', ensureAuthenticated, userController.addLink);

// Upd Link
router.get('/link/update/:alias', ensureAuthenticated, userController.updlink);

// Deatail Link
router.get('/link/gen-qr/:alias', ensureAuthenticated, userController.genQRCode);
router.get('/link/:alias', ensureAuthenticated, userController.link);

// Set Status Link
router.post('/link/update', ensureAuthenticated, userController.updLink);

// Set Status Link
router.post('/link/changeStatus', ensureAuthenticated, userController.changeStatusLink);

// Hapus Link
router.post('/link/hapus', ensureAuthenticated, userController.delLink);

// Bio
router.get('/bios', ensureAuthenticated, userController.bios);

router.get('/bios/create', ensureAuthenticated, userController.createBioForm);

router.post('/bios', ensureAuthenticated, upload.single('logo'), userController.createBio);

router.get('/bios/:id/edit', ensureAuthenticated, userController.editBioForm);

router.post('/bios/:id/update', ensureAuthenticated, upload.single('logo'), userController.updateBio);

router.post('/bios/:id/delete', ensureAuthenticated, userController.deleteBio);

router.get('/analytics', ensureAuthenticated, userController.analytics);

router.get('/analytic/:id', ensureAuthenticated, userController.analytic);

// Custom QR Codes
router.get('/qrcodes', ensureAuthenticated, qrCodeController.renderUserPage);
router.get('/qrcodes/create', ensureAuthenticated, qrCodeController.renderUserCreatePage);
router.get('/qrcodes/data', ensureAuthenticated, qrCodeController.listUserData);
router.get('/qrcodes/:id', ensureAuthenticated, qrCodeController.getOne);
router.post('/qrcodes', ensureAuthenticated, upload.single('logo'), qrCodeController.createQrCode);
router.post('/qrcodes/:id/update', ensureAuthenticated, qrCodeController.updateQrCode);
router.post('/qrcodes/:id/delete', ensureAuthenticated, qrCodeController.deleteQrCode);



router.get('/profile', ensureAuthenticated, userController.profile);
router.post('/profile/update', ensureAuthenticated, userController.updateProfile);
router.post('/profile/password', ensureAuthenticated, userController.updateProfilePassword);
router.post('/profile/photo', ensureAuthenticated, (req, res, next) => {
  profilePhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error_msg', err.message || 'Upload foto profil gagal.');
      return res.redirect('/users/profile');
    }
    return next();
  });
}, userController.updateProfilePhoto);

module.exports = router;
