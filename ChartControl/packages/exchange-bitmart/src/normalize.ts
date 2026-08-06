import type { AccountBalance, NormalizedOrder, Position } from './interfaces';

/** BitMart-specific → normalized. Isolated so BitMart API drift is a one-file fix (ADR-0002). */
const rows = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const data = (raw as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    for (const k of ['positions', 'orders', 'symbols']) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
};

const S = (v: unknown, d = '0'): string => (v === undefined || v === null ? d : String(v));

export function normalizeBalances(raw: unknown): AccountBalance[] {
  return rows(raw).map((r) => ({
    asset: S(r['currency'] ?? r['asset'], 'USDT'),
    available: S(r['available_balance'] ?? r['available']),
    equity: S(r['equity'] ?? r['balance']),
    used: S(r['frozen_balance'] ?? r['used']),
  }));
}

export function normalizePositions(raw: unknown): Position[] {
  return rows(raw).map((r) => ({
    symbol: S(r['symbol'], ''),
    side: Number(r['current_amount'] ?? r['position_amount'] ?? 0) >= 0 && String(r['position_type'] ?? r['side'] ?? 'long').toLowerCase() !== 'short' ? 'long' : 'short',
    size: S(r['current_amount'] ?? r['hold_volume'] ?? r['size']),
    entryPrice: S(r['entry_price'] ?? r['open_avg_price']),
    markPrice: r['mark_price'] !== undefined ? S(r['mark_price']) : undefined,
    liquidationPrice: r['liquidation_price'] !== undefined ? S(r['liquidation_price']) : undefined,
    leverage: Number(r['leverage'] ?? 1),
    marginMode: String(r['margin_type'] ?? r['open_type'] ?? 'isolated').toLowerCase().includes('cross') ? 'cross' : 'isolated',
    unrealizedPnl: r['unrealized_value'] !== undefined ? S(r['unrealized_value']) : undefined,
  }));
}

const STATE_MAP: Record<string, string> = {
  '1': 'SUBMITTING', '2': 'OPEN', '4': 'FILLED', '5': 'PARTIALLY_FILLED', '6': 'CANCELED',
  new: 'OPEN', partially_filled: 'PARTIALLY_FILLED', filled: 'FILLED', canceled: 'CANCELED', rejected: 'REJECTED',
};

export function normalizeOrder(r: Record<string, unknown>): NormalizedOrder {
  const now = Date.now();
  return {
    clientOrderId: S(r['client_order_id'] ?? r['clientOid'], ''),
    exchangeOrderId: r['order_id'] !== undefined ? S(r['order_id']) : undefined,
    symbol: S(r['symbol'], ''),
    side: String(r['side'] ?? '').toLowerCase().includes('sell') || String(r['side'] ?? '') === '2' || String(r['side'] ?? '') === '3' ? 'short' : 'long',
    type: String(r['type'] ?? 'limit').toLowerCase() === 'market' ? 'market' : 'limit',
    price: r['price'] !== undefined ? S(r['price']) : undefined,
    quantity: S(r['size'] ?? r['vol'] ?? r['quantity']),
    filledQuantity: S(r['filled_size'] ?? r['deal_size'] ?? '0'),
    status: STATE_MAP[String(r['state'] ?? r['status'] ?? '').toLowerCase()] ?? STATE_MAP[String(r['state'] ?? '')] ?? 'OPEN',
    reduceOnly: r['reduce_only'] === true,
    createdAt: Number(r['create_time'] ?? now),
    updatedAt: Number(r['update_time'] ?? now),
  };
}

export function normalizeOrders(raw: unknown): NormalizedOrder[] {
  return rows(raw).map(normalizeOrder);
}
