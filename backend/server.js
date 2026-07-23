require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// Serve the frontend as static files
app.use(express.static(path.join(__dirname, '../frontend/public')));

// API routes
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api/business', require('./routes/business'));

// Only start listening when this file is run directly (e.g. `node backend/server.js`
// or `npm start`/`npm run dev`). When it's required from elsewhere (e.g. the test
// suite, via supertest), the caller gets the configured `app` without an extra
// server already bound to PORT.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Reply Assistant server listening on port ${PORT}`);
  });
}

module.exports = app;
