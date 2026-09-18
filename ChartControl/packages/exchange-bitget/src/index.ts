export { BitgetPublicRest, BITGET_BASE, BITGET_OK, type BitgetRestOptions, type BitgetEnvelope } from './rest.js';
export { BitgetMarketData } from './market-adapter.js';
export { normalizeCandles, normalizeTickers, rowToCandle, rowToTicker } from './normalize.js';
export { toGranularity, UNSUPPORTED_TIMEFRAMES, PRODUCT_TYPE } from './symbols.js';
export { BitgetPrivateRest, type BitgetPrivateOptions, type VerifyResult, type BitgetPosition } from './private-rest.js';
export { authHeaders, prehash, sign, type BitgetCredentials, type HttpMethod } from './signature.js';
export { BitgetV3Rest, V3_CATEGORY, type BitgetV3Options, type V3Asset, type V3Position } from './v3-rest.js';
export { classifyError, CODE_IS_CLASSIC, CODE_IS_UNIFIED, type BitgetAccountMode, type ModeDetection } from './account-mode.js';
export { BitgetV3Trading, type V3SubmitRequest, type V3SubmitOutcome } from './v3-trading.js';
