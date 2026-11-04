require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const auth = require('./middleware/auth');
const company = require('./middleware/company');

const app = express();
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : false;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), require('./routes/auth'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Phoenix Business Suite API' }));
app.use('/api', auth, company);
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/custom', require('./routes/custom'));
app.use('/api/crm', require('./routes/crm'));
app.use('/api/operations', require('./routes/operations'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use(express.static(path.join(__dirname, '../../frontend')));
app.use((err, req, res, next) => {
  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with the same unique value already exists' });
  }
  if (err.code === '23503' || err.code === '23514' || err.code === '22P02') {
    return res.status(400).json({ error: 'The request contains an invalid value or reference' });
  }

  console.error(err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Phoenix Business Suite running on http://localhost:${port}`));
