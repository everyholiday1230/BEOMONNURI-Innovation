/**
 * 마켓 REST 라우트. /api/v1/market/*
 *
 * 전부 공개 데이터라 인증이 없다. 사용자별 데이터(잔고/주문/포지션)는
 * 이 라우터에 절대 넣지 않는다. 인증 라우터가 생기면 그쪽으로 분리한다.
 */

import { Router } from 'express';

import { config } from '../config.js';
import { marketService } from './service.js';
import { SUPPORTED_TIMEFRAMES } from '../exchanges/kucoin/symbols.js';

/** 프론트엔드 마켓 목록의 기본 구성. 디자이너 목업의 21개 심볼과 동일 순서. */
export const DEFAULT_MARKET_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'ARBUSDT',
  'OPUSDT', 'ATOMUSDT', 'DOTUSDT', 'ADAUSDT', 'NEARUSDT',
  'INJUSDT', 'APTUSDT', 'SUIUSDT', 'TONUSDT', 'FILUSDT', 'LTCUSDT',
];

function parseSymbols(raw) {
  if (!raw) return null;
  return String(raw)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createMarketRouter() {
  const router = Router();

  /** 서비스/업스트림 상태. 헬스체크 및 운영 대시보드용. */
  router.get('/status', (req, res) => {
    res.json({ ok: true, data: marketService.getStatus() });
  });

  /** 계약 사양 목록. 주문 수량/가격 반올림에 필요하다. */
  router.get('/instruments', (req, res) => {
    const symbols = parseSymbols(req.query.symbols);
    const all = [...marketService.instruments.values()];
    const data = symbols ? all.filter((i) => symbols.includes(i.symbol)) : all;
    res.json({ ok: true, count: data.length, data });
  });

  /**
   * 프론트엔드 마켓 목록. 목업 QT.MARKETS 와 동일한 필드를 제공한다.
   * KuCoin 에 상장되지 않은 심볼은 available:false 로 표시하고 목록에서 빼지 않는다.
   * (버튼/행을 삭제하지 않는다는 UI 계약을 지키기 위함)
   */
  router.get('/markets', (req, res) => {
    const symbols = parseSymbols(req.query.symbols) || DEFAULT_MARKET_SYMBOLS;

    const data = symbols.map((symbol) => {
      const t = marketService.getTicker(symbol);
      const instrument = marketService.getInstrument(symbol);
      const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;

      if (!t || !instrument) {
        return {
          symbol,
          base,
          quote: 'USDT',
          type: 'PERP',
          available: false,
          reason: 'KuCoin 선물 미상장',
        };
      }

      return {
        symbol,
        base,
        quote: 'USDT',
        type: 'PERP',
        available: instrument.tradable,
        price: t.last,
        chg24h: t.chg24hPct,
        vol24h: t.vol24hQuote,
        hi: t.high24h,
        lo: t.low24h,
        mark: t.mark,
        index: t.index,
        bid: t.bid,
        ask: t.ask,
        fundingRate: t.fundingRate,
        nextFundingTime: t.nextFundingTime,
        openInterest: t.openInterest,
        tickSize: instrument.tickSize,
        multiplier: instrument.multiplier,
        maxLeverage: instrument.maxLeverage,
        takerFeeRate: instrument.takerFeeRate,
        makerFeeRate: instrument.makerFeeRate,
        ts: t.ts,
      };
    });

    res.json({ ok: true, count: data.length, data });
  });

  router.get('/ticker/:symbol', (req, res) => {
    const t = marketService.getTicker(req.params.symbol);
    if (!t) return res.status(404).json({ ok: false, error: '심볼을 찾을 수 없음' });
    res.json({ ok: true, data: t });
  });

  router.get('/orderbook/:symbol', async (req, res, next) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const rows = clampInt(req.query.rows, 20, 1, 100);

      let book = marketService.getOrderBook(symbol);
      if (!book) {
        await marketService.primeSnapshot(symbol);
        book = marketService.getOrderBook(symbol);
      }
      if (!book) return res.status(404).json({ ok: false, error: '오더북 없음' });

      res.json({
        ok: true,
        data: { ...book, bids: book.bids.slice(0, rows), asks: book.asks.slice(0, rows) },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/trades/:symbol', async (req, res, next) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const limit = clampInt(req.query.limit, 60, 1, 100);

      let trades = marketService.getTrades(symbol, limit);
      if (trades.length === 0) {
        await marketService.primeSnapshot(symbol);
        trades = marketService.getTrades(symbol, limit);
      }
      res.json({ ok: true, count: trades.length, data: trades });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 캔들. 프론트엔드 차트의 원천.
   * GET /candles/BTCUSDT?tf=15m&limit=220
   */
  router.get('/candles/:symbol', async (req, res, next) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const tf = String(req.query.tf || '15m');
      const limit = clampInt(req.query.limit, config.market.klineLimit, 1, 500);

      if (!SUPPORTED_TIMEFRAMES.includes(tf) && tf !== '3m') {
        return res.status(400).json({
          ok: false,
          error: '지원하지 않는 타임프레임',
          supported: SUPPORTED_TIMEFRAMES,
        });
      }

      const candles = await marketService.fetchCandles(symbol, tf, limit);
      res.json({
        ok: true,
        symbol,
        timeframe: tf,
        count: candles.length,
        data: candles.slice(-limit),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
