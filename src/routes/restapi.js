const express = require('express');
const router = express.Router();

// Load Controller
const restApiController = require("../controllers/restApi");

// Create Link
router.post("/link", restApiController.createLink);


module.exports = router;
