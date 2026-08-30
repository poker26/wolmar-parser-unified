'use strict';

// Compatibility for old workflow histories. Interactive requests call the
// application service directly and no longer create Temporal workflows.
module.exports = require('../app-v1/valuation/calculator');
