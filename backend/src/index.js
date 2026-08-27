const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const citiesRoutes = require('./routes/cities');
const weatherRoutes = require('./routes/weather');
const geocodeRoutes = require('./routes/geocode');
const prefsRoutes = require('./routes/prefs');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-weather-backend' }));

// Login/register/session are served by the shared quarc-auth container — nginx
// intercepts /api/auth/* before it reaches this backend. Everything here just
// verifies the JWT that service issued, using the same JWT_SECRET.
app.use('/api/cities', requireAuth, citiesRoutes);
app.use('/api/weather', requireAuth, weatherRoutes);
app.use('/api/geocode', requireAuth, geocodeRoutes);
app.use('/api/prefs', requireAuth, prefsRoutes);

app.use((err, _req, res, _next) => {
  console.error('[quarc-weather]', err);
  res.status(500).json({ error: 'Internal error' });
});

initDb();

app.listen(PORT, () => {
  console.log(`Quarc Weather backend listening on :${PORT}`);
});
