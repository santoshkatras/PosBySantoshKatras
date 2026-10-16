import { createApp } from './app.mjs';
import { seedDemos } from './seed.mjs';
import { seedService } from './service-seed.mjs';

// `npm start` passes --production (works on Windows too, unlike NODE_ENV=production in the script).
if (process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.argv.includes('--production')) {
  process.env.NODE_ENV = 'production';
}

const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000);
const onCatalyst = Boolean(process.env.X_ZOHO_CATALYST_LISTEN_PORT);

async function boot() {
  try {
    const created = await createApp();
    if (!onCatalyst) await created.store.ping();
    return created;
  } catch (error) {
    const text = String(error?.message || '');
    if (onCatalyst || !/free tier|oauth token/i.test(text)) throw error;
    console.error('Catalyst Data Store is out of free fetches. Starting a local demo shop so sign-in works.');
    return createApp({ store: 'memory' });
  }
}

const { app, store } = await boot();
if (!onCatalyst && process.env.SEED_DEMOS !== '0') {
  await seedDemos(store);
  try {
    await seedService(store);
  } catch (error) {
    console.error(`Workshop demo data was not loaded: ${error.message}. Create the service tables in Catalyst (see README).`);
  }
}
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`SKPOS listening on http://127.0.0.1:${port}`);
  console.log(store.kind === 'sqlite' ? `Data: SQLite ${store.file}` : `Data: ${store.kind} store`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nPort ${port} is already in use — SKPOS is probably already running at http://127.0.0.1:${port}`);
    console.error('Use that window, or close it (Ctrl+C) and run npm start again. Only one SKPOS may use the data file at a time.\n');
    process.exit(1);
  }
  throw error;
});

const stop = () => { store.flush?.(); server.close(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
