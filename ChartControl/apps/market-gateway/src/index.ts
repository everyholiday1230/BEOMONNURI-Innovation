import { startGateway } from './server';

// Entry point. Graceful shutdown on SIGTERM/SIGINT (rolling deploys drain connections). Live trading
// is never enabled here — this is a read-only PUBLIC market-data fan-out gateway.
const gw = await startGateway();
 
console.log(`[market-gateway] up on :${gw.port}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
     
    console.log(`[market-gateway] ${sig} — draining`);
    void gw.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
