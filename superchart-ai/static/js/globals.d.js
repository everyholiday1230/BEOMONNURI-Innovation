/**
 * BEOM ON AI - 전역 타입 선언 (JSDoc)
 *
 * 이 파일은 **런타임 효과 없음**. 오직 IDE 자동완성 / TypeScript check 용.
 *
 * 역할:
 * - window.* 전역 182 개의 의도된 인터페이스 명세
 * - module 시스템 전환 전까지 참조 문서로 활용
 * - 새로 추가되는 전역은 이 파일에 먼저 기재
 */

/**
 * @typedef {Object} BeomAppState
 * @property {string} [curSymbol] 현재 선택된 심볼 (예: "BTCUSDT")
 * @property {string} [curTf]     현재 선택된 타임프레임 (예: "1h")
 * @property {boolean} [isLoggedIn] 로그인 여부
 * @property {boolean} [isPremium]  프리미엄 등급 여부
 * @property {boolean} [isAdmin]    관리자 여부
 */

/**
 * @typedef {Object} BeomAppCore
 * @property {Object} [chart]       현재 차트 엔진 인스턴스
 * @property {Object} [ChartCore]   차트 코어 클래스
 * @property {string} [API]         API base URL
 * @property {Object} [COS]         구 ChartOS 엔진 (deprecated)
 */

/**
 * @typedef {Object} ApiHelper
 * @property {(url: string, opts?: object) => Promise<Response>} raw
 * @property {(url: string) => Promise<any>} get
 * @property {(url: string, body?: any) => Promise<any>} post
 * @property {(url: string, body?: any) => Promise<any>} put
 * @property {(url: string) => Promise<any>} del
 */

/**
 * @typedef {Object} BeomAppUtil
 * @property {ApiHelper} [api]                      공통 API 호출 helper
 * @property {(msg: string, color?: string) => void} [showToast]
 * @property {(key: string) => string} [t]          i18n 함수
 * @property {(key: string, fn: () => Promise<any>) => Promise<any>} [dedupFetch]
 * @property {(s: any) => string} [sanitize]        HTML escape
 * @property {(s: any) => string} [esc]             sanitize 별칭
 * @property {(el: Element, t: any) => void} [setText]
 * @property {(s: any) => string} [_escHtml]
 * @property {(u: string) => string} [_safeUrl]
 */

/**
 * @typedef {Object} BeomAppNamespace
 * @property {string} version
 * @property {BeomAppState} state
 * @property {BeomAppCore} core
 * @property {BeomAppUtil} util
 * @property {Object} render
 * @property {Object} action
 * @property {Object} data
 * @property {Object} demo
 * @property {() => Object} dump  카테고리별 키 목록 반환
 */

/**
 * @global
 * @type {BeomAppNamespace}
 */
window.BeomApp;

// deprecated 목록 — 신규 코드에서 사용 금지, namespace 로 대체
// 예: window.curSymbol → BeomApp.state.curSymbol
// 예: window.showToast → BeomApp.util.showToast
// 예: window._addFav   → BeomApp.action.favorite.addFav
