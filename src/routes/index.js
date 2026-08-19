const express = require("express");
const router = express.Router();

const Jimp = require("jimp");
const {
  PDFDocument
} = require("pdf-lib");

const {
  ensureAuthenticated,
  forwardAuthenticated
} = require("../config/auth");

// Load Controller
const controller = require("../controllers/index");

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
});

// Welcome Page
// router.get("/", forwardAuthenticated, (req, res) => {
//   // res.redirect("login");
//   res.render("view/common/index");

// });
router.get("/", forwardAuthenticated, controller.index);

router.get("/about", forwardAuthenticated, controller.about);

router.get("/apps", forwardAuthenticated, controller.apps);

router.get("/contact", forwardAuthenticated, controller.contact);

router.post("/feedback", forwardAuthenticated, controller.feedback);

router.get("/lokasi-wisuda", controller.lokasiWisuda);



router.get("/login", forwardAuthenticated, controller.login);
router.get("/auth/sso/callback", controller.ssoCallback);

router.post("/api/link", ensureAuthenticated, controller.apiLinks);

router.post("/api/users", ensureAuthenticated, controller.apiUsers);


router.post("/link", controller.link);


router.get("/application", controller.application);

router.get("/bio", controller.bioLanding);
router.get("/bio/:alias", controller.bioPage);

router.get("/whats-new", controller.whatsNew);

router.get("/:segmen/:alias", controller.direct);

router.get("/:alias", controller.direct);

// Html 404 
router.get("/*", async (req, res) => {
  res.render("404");
});

module.exports = router;
