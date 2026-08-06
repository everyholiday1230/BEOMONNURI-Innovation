/* ============================================================
   Mock Stream — 500ms tick simulated market data
   Simulates: price, spread, order book flicker, recent trade tape
   Emits a Redux-lite bus via QT.stream.on(event, cb)
   ============================================================ */

(function () {
  'use strict';

  const listeners = new Map(); // event -> Set<cb>

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event).delete(cb);
  }
  function emit(event, data) {
    const s = listeners.get(event);
    if (!s) return;
    for (const cb of s) cb(data);
  }

  let state = {
    symbol: 'BTCUSDT',
    price: 68432.5,
    prev: 68432.5,
    change24: 2.34,
    hi24: 69120.0,
    lo24: 66890.4,
    vol24: 18_240_000_000,
    mark: 68436.2,
    index: 68430.8,
    funding: 0.0084,
    nextFunding: Date.now() + 3_240_000, // ~54min
    latencyMs: 34,
    connected: true,
    connectionState: 'live', // live | reconnecting | lost
  };

  function tick() {
    if (!state.connected) return;
    // Random walk around ~68432 with 0.03% typical move
    const drift = (Math.random() - 0.495) * state.price * 0.0003;
    state.prev = state.price;
    state.price = Math.max(1, state.price + drift);
    state.mark = state.price + (Math.random() - 0.5) * state.price * 0.00008;
    state.index = state.price + (Math.random() - 0.5) * state.price * 0.00006;
    state.latencyMs = 20 + Math.random() * 40;
    emit('tick', { ...state });

    // Order book perturbation
    const ob = QT.generateOrderBook(state.price, 3.5 + Math.random() * 2);
    emit('orderbook', ob);

    // Emit a trade every ~1.5 ticks
    if (Math.random() > 0.35) {
      const side = Math.random() > (state.price >= state.prev ? 0.42 : 0.58) ? 'buy' : 'sell';
      const amt = +(0.005 + Math.random() * 1.8).toFixed(4);
      emit('trade', {
        time: Date.now(),
        price: state.price + (Math.random() - 0.5) * 0.4,
        amount: amt,
        side,
      });
    }
  }

  let interval = null;
  function start() {
    if (interval) return;
    interval = setInterval(tick, 500);
  }
  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
  }
  function setConnectionState(s) {
    state.connectionState = s;
    state.connected = s === 'live';
    emit('connection', { state: s });
    if (s === 'live' && !interval) start();
  }
  function getState() { return { ...state }; }

  window.QT = window.QT || {};
  window.QT.stream = { on, emit, start, stop, tick, getState, setConnectionState };
})();
