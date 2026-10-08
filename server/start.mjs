import { createApp } from './app.mjs';
import { seedDemos } from './seed.mjs';

const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000);
const { app, db } = await createApp();
seedDemos(db);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Stockkeep listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
