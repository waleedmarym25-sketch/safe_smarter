const express = require('express');
const router = express.Router();
const periodController = require('../controllers/period.controller');

// All routes are protected by authenticateToken middleware in main router
router.get('/cycles', periodController.getUserCycles);
router.post('/cycles', periodController.logCycle);
router.delete('/cycles/:id', periodController.deleteCycle);
router.get('/analytics', periodController.getAnalytics);

module.exports = router;
