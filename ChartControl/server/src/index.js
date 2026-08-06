/**
 * QuantumTrade AI 백엔드 진입점.
 *
 * 디자이너 산출물(정적 SPA)을 같은 오리진에서 서빙한다.
 * 이유: 브라우저가 다른 오리진의 API 를 부르면 CORS 프리플라이트와 쿠키
 * SameSite 문제가 생기고, 나중에 세션 인증을 붙일 때 더 복잡해진다.
 * 단일 오리진이면 그런 문제가 처음부터 없다.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { config, hasBrokerCredentials } from './config.js';
import { log } from './log.js';
import { marketService } from './market/service.js';
import { createMarketRouter } from './market/routes.js';
import { attachWsGateway } from './gateway/ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src -> server -> 프로젝트 루트(디자이너 산출물이 있는 곳)
const projectRoot = path.resolve(__dirname, '..', '..');
const staticDir = config.staticDir ? path.resolve(config.staticDir) : projectRoot;

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));

// --- 보안 헤더 -------------------------------------------------------------
// 이 앱은 CDN(React/Babel/폰트)을 쓰고 인라인 스타일이 많아 CSP 를 좁게 잡으면
// 디자인이 깨진다. 지금은 프레임 차단과 MIME 스니핑 차단만 적용하고,
// 빌드 파이프라인 전환 후 CSP 를 조여야 한다.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// --- 헬스체크 --------------------------------------------------------------
app.get('/healthz', (req, res) => {
  const status = marketService.getStatus();
  const healthy = status.ready && status.connection === 'live';
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    uptimeSec: Math.round(process.uptime()),
    market: status,
    broker: {
      // 자격증명 값은 절대 노출하지 않는다. 설정 여부만 알린다.
      configured: hasBrokerCredentials(),
      exchange: config.exchange,
    },
  });
});

// --- API -----------------------------------------------------------------
app.use('/api/v1/market', createMarketRouter());

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: '없는 엔드포인트', path: req.originalUrl });
});

// --- 정적 파일 (디자이너 산출물. 내용은 수정하지 않는다) -------------------

/**
 * 프론트엔드가 "백엔드가 있는지"를 네트워크 요청 없이 알 수 있게 표시한다.
 *
 * 왜 필요한가: 이 폴더는 백엔드 없이 정적 서버(python -m http.server)로도
 * 그대로 열리는 것이 디자이너 산출물의 계약이다. 그때 프론트엔드가 /api 를
 * 찔러보면 404 가 나고 브라우저 콘솔에 에러가 찍힌다. "콘솔 에러 0" 계약이
 * 깨진다.
 *
 * Server-Timing 헤더는 동일 오리진에서 JS 로 읽을 수 있고
 * (performance.getEntriesByType('navigation')[0].serverTiming),
 * 추가 요청이 필요 없다. 그래서 이 헤더 하나로 판별한다.
 */
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.setHeader('Server-Timing', 'qtbackend;desc="live"');
  }
  next();
});

app.use(
  express.static(staticDir, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, filePath) {
      // 개발 중 캐시로 인한 혼란을 막는다. 프로덕션에서는 해시 파일명 + 장기 캐시로 전환.
      if (/\.(js|jsx|css|html)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// SPA 는 해시 라우팅(#/path)을 쓰므로 서버 사이드 폴백이 사실상 필요 없지만,
// 직접 경로 접근 시 index.html 을 주도록 해 404 를 방지한다.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/ws') return next();
  res.sendFile(path.join(staticDir, 'index.html'), (err) => (err ? next(err) : undefined));
});

// --- 오류 핸들러 ----------------------------------------------------------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    log.error('처리되지 않은 요청 오류', { path: req.originalUrl, error: String(err?.message || err) });
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    ok: false,
    error: status >= 500 ? '서버 내부 오류' : String(err.message || '요청 오류'),
    ...(err.detail ? { detail: err.detail } : {}),
  });
});

// --- 부팅 ----------------------------------------------------------------
const server = http.createServer(app);
const gateway = attachWsGateway(server, '/ws');

async function main() {
  log.info('부팅 시작', {
    env: config.env,
    exchange: config.exchange,
    staticDir,
    brokerConfigured: hasBrokerCredentials(),
  });

  if (!hasBrokerCredentials()) {
    log.warn(
      '브로커 자격증명 미설정 — 시세는 정상 동작하지만 주문 리베이트는 집계되지 않는다. ' +
        'KUCOIN_BROKER_PARTNER / KUCOIN_BROKER_KEY / KUCOIN_BROKER_NAME 을 설정할 것.',
    );
  }

  // 시세 서비스가 실패해도 서버는 떠야 한다. 프론트엔드가 목업으로 폴백하기 때문.
  try {
    await marketService.start();
  } catch (err) {
    log.error('마켓 서비스 시작 실패 — 서버는 계속 뜬다', {
      error: String(err?.message || err),
    });
  }

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  log.info('수신 대기', { url: `http://${config.host}:${config.port}` });
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('종료 시작', { signal });

  gateway.close();
  marketService.stop();
  server.close(() => {
    log.info('종료 완료');
    process.exit(0);
  });

  // 소켓이 남아 닫히지 않는 경우 강제 종료
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) =>
  log.error('unhandledRejection', { error: String(reason) }),
);
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { error: String(err?.message || err), stack: err?.stack });
  shutdown('uncaughtException');
});

main().catch((err) => {
  log.error('부팅 실패', { error: String(err?.message || err), stack: err?.stack });
  process.exit(1);
});

export { app, server };
