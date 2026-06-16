import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { siteConfig, buildTokenMap } from './site.config.js';

const pages = {
  main: resolve(__dirname, 'index.html'),
  products: resolve(__dirname, 'products/index.html'),
  privateAi: resolve(__dirname, 'products/private-ai/index.html'),
  superChartAi: resolve(__dirname, 'products/superchart-ai/index.html'),
  agentAi: resolve(__dirname, 'products/agent-ai/index.html'),
  farmAi: resolve(__dirname, 'products/farm-shipping-ai/index.html'),
  commodityAi: resolve(__dirname, 'products/commodity-procurement-ai/index.html'),
  apartmentAi: resolve(__dirname, 'products/apartment-management-ai/index.html'),
  company: resolve(__dirname, 'company/index.html'),
  contact: resolve(__dirname, 'contact/index.html'),
  privacy: resolve(__dirname, 'privacy/index.html'),
  enMain: resolve(__dirname, 'en/index.html'),
  enProducts: resolve(__dirname, 'en/products/index.html'),
  enPrivateAi: resolve(__dirname, 'en/products/private-ai/index.html'),
  enSuperChartAi: resolve(__dirname, 'en/products/superchart-ai/index.html'),
  enAgentAi: resolve(__dirname, 'en/products/agent-ai/index.html'),
  enFarmAi: resolve(__dirname, 'en/products/farm-shipping-ai/index.html'),
  enCommodityAi: resolve(__dirname, 'en/products/commodity-procurement-ai/index.html'),
  enApartmentAi: resolve(__dirname, 'en/products/apartment-management-ai/index.html'),
  enCompany: resolve(__dirname, 'en/company/index.html'),
  enContact: resolve(__dirname, 'en/contact/index.html'),
  enPrivacy: resolve(__dirname, 'en/privacy/index.html')
};

/**
 * HTML 내 {{KEY}} 토큰을 site.config.js 값으로 치환.
 * SITE_URL 등 "확정된" 값만 치환하고, 회사정보 플레이스홀더({{사업자등록번호}} 등)는
 * 의도적으로 그대로 남겨 발행 전 채울 항목임을 노출한다.
 */
function htmlTokenReplace() {
  const tokenMap = buildTokenMap(siteConfig);
  // 한글 플레이스홀더는 남겨두기 위해 영문 키만 치환 대상으로 한다.
  const replaceKeys = ['SITE_URL', 'EMAIL', 'FORM_ENDPOINT', 'COMPANY_NAME_KR', 'COMPANY_NAME_EN'];
  return {
    name: 'html-token-replace',
    transformIndexHtml(html) {
      let out = html;
      for (const key of replaceKeys) {
        out = out.split(`{{${key}}}`).join(tokenMap[`{{${key}}}`] ?? '');
      }
      return out;
    }
  };
}

export default defineConfig({
  plugins: [htmlTokenReplace()],
  server: {
    // Sandbox public URL 접속 차단 방지
    // (동적으로 바뀌는 *.sandbox.novita.ai 호스트 허용)
    allowedHosts: true
  },
  build: {
    rollupOptions: {
      input: pages
    }
  }
});
