const express = require("express");
const router = express.Router();
const excelJS = require("exceljs");

// Load Controller
const adminController = require("../controllers/admin");
const qrCodeController = require("../controllers/qrCodeController");

const {
  ensureAuthenticated,
  ensureAdmin,
} = require("../config/auth");

const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { resolveFromAssets } = require("../utils/paths");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, resolveFromAssets('uploads'));
  },
  filename: (req, file, cb) => {
    const dateTime = new Date()
      .toISOString()
      .slice(-24)
      .replace(/\D/g, "")
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

router.use(ensureAuthenticated, ensureAdmin);

// Welcome Page
router.get("/", adminController.index);

// Dashboard
router.get("/dashboard", adminController.index);

// Main
// 1. Links
router.get("/links", adminController.links);
router.get("/linkadd", adminController.linkAdd);
router.get("/linkadd/segmen-options", adminController.linkAddSegmenOptions);

// 1.1 Link Detail
router.get("/link/:id", adminController.link);

router.get("/link/gen-qr/:alias", adminController.genQRCode);

// Custom QR Codes
router.get("/qrcodes", qrCodeController.renderAdminPage);
router.get("/qrcodes/create", qrCodeController.renderAdminCreatePage);
router.get("/qrcodes/data", qrCodeController.listAdminData);
router.get("/qrcodes/:id", qrCodeController.getOne);
router.post("/qrcodes", upload.single('logo'), qrCodeController.createQrCode);
router.post("/qrcodes/:id/update", qrCodeController.updateQrCode);
router.post("/qrcodes/:id/delete", qrCodeController.deleteQrCode);


// 1.b Bio Pages
router.get("/bios", adminController.bios);
router.get("/bios/create", adminController.createBioForm);
router.post("/bios", upload.single('logo'), adminController.createBio);
router.get("/bios/:id/edit", adminController.editBioForm);
router.post("/bios/:id/update", upload.single('logo'), adminController.updateBio);
router.post("/bios/:id/delete", adminController.deleteBio);


// 1.c What's New
router.get("/whatsnew", adminController.whatsnew);
router.get("/whatsnew/create", adminController.createWhatsNewForm);
router.post("/whatsnew", adminController.createWhatsNew);
router.get("/whatsnew/:id/edit", adminController.editWhatsNewForm);
router.post("/whatsnew/:id/update", adminController.updateWhatsNew);
router.post("/whatsnew/:id/delete", adminController.deleteWhatsNew);
// 1.d Teams
router.get("/teams", adminController.teams);
router.get("/teams/create", adminController.createTeamForm);
router.post("/teams", upload.single('photo'), adminController.createTeam);
router.get("/teams/:id/edit", adminController.editTeamForm);
router.post("/teams/:id/update", upload.single('photo'), adminController.updateTeam);
router.post("/teams/:id/delete", adminController.deleteTeam);

// 1.e Segmen
router.get("/segmen", adminController.segmen);
router.get("/segmen/options/:type", adminController.segmenOptions);
router.post("/segmen", adminController.createSegmen);
router.post("/segmen/:id/update", adminController.updateSegmen);
router.post("/segmen/:id/delete", adminController.deleteSegmen);

// 2. Stats

// 2. Analytics
router.get("/analytics", adminController.analytics);

// 2.1 Analytic
router.get("/analytic/:id", adminController.analytic);

// 3. Users
router.get("/users", adminController.users);

// 4. Feedback
router.get("/feedback", adminController.feedback);

module.exports = router;
