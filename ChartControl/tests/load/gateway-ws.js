import ws from 'k6/ws';
import { check } from 'k6';

// Phase 6 §4 — internal WebSocket Gateway load. Connects to the gateway (MOCK_REPLAY upstream),
// subscribes to a popular symbol (fan-out), holds, then closes. VUs/duration via env. 10k is a
// separate goal recorded Not Executed unless the environment sustains it.
const PORT = __ENV.GW_PORT || 8790;
const HOLD = Number(__ENV.HOLD_MS || 4000);
export const options = {
  vus: Number(__ENV.VUS || 100),
  duration: __ENV.DURATION || '20s',
  thresholds: { ws_connecting: ['p(95)<2000'], ws_session_duration: ['p(95)>=0'] },
};

export default function () {
  const url = `ws://127.0.0.1:${PORT}/ws?token=user:${__VU}`;
  const res = ws.connect(url, { headers: { Origin: 'http://localhost:5173' } }, (socket) => {
    let messages = 0;
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT' }));
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'ticker', symbol: 'ETHUSDT' }));
    });
    socket.on('message', () => { messages += 1; });
    socket.setTimeout(() => { check(null, { 'received fan-out messages': () => messages > 0 }); socket.close(); }, HOLD);
  });
  check(res, { 'ws handshake 101': (r) => r && r.status === 101 });
}
