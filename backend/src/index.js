const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-weather-backend' }));

// Login/register/session are served by the shared quarc-auth container — nginx
// intercepts /api/auth/* before it reaches this backend. Everything here just
// verifies the JWT that service issued, using the same JWT_SECRET.
//
// This backend no longer proxies weather: every device asks the weather
// provider directly. It only keeps what must follow an account between devices.
app.use('/api/sync', requireAuth, syncRoutes);

app.use((err, _req, res, _next) => {
  console.error('[quarc-weather]', err);
  res.status(500).json({ error: 'Internal error' });
});

initDb();

app.listen(PORT, () => {
  console.log(`Quarc Weather backend listening on :${PORT}`);
});
