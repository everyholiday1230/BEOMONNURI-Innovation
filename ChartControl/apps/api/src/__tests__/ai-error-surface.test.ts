import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/*
   ★★ **서버 내부 영어가 고객 화면에 새지 않는지** 잠근다.

     `ai_stream_error: 'AI response failed: {msg}'` 에 서버 message 가 그대로 들어갔다.
     그 message 는 개발자를 위한 영어다:

       "setup review requires market data"
       "Model output rejected: guarantee-language"
       "the user has not stated a direction — ask them to choose instead of proposing one"

     고객 신고가 정확히 이 형태로 들어왔다: "AI response failed: HTTP 403".
     무엇이 잘못됐는지도, 무엇을 하면 되는지도 알 수 없다.

   ★ 이 검사가 없으면 새 오류 코드를 추가할 때마다 같은 일이 반복된다. 실제로 반복됐다.
*/
describe('AI 오류 표시 — 서버 내부 문장을 고객에게 보여주지 않는다', () => {
  const src = () => stripComments(read('../../../../src/ai-copilot.jsx'));

  /*
     ★★ 핵심 검사: 서버 message 를 화면 문구에 끼워 넣지 않는지.

       `ev.message` / `e.message` 를 t(...) 인자로 넘기면 그 순간 영어가 노출된다.
  */
  it('서버 message 를 화면 문구에 끼워 넣지 않는다', () => {
    const code = src();
    expect(code, 'ev.message 를 문구에 넣고 있다 — 개발자용 영어가 노출된다')
      .not.toMatch(/t\(\s*['"]ai_stream_error['"][\s\S]{0,80}ev\.message/);
    expect(code, 'e.message 를 문구에 넣고 있다')
      .not.toMatch(/t\(\s*['"]ai_stream_error['"][\s\S]{0,80}e\s*&&\s*e\.message/);
  });

  /*
     ★ 알려진 코드가 전용 문구로 매핑되는지. 매핑이 없으면 일반 문구로 떨어지는데,
       그것 자체는 안전하지만 고객이 무엇을 해야 할지 모른다.
  */
  const MAPPED_CODES = [
    'ungrounded-proposal',
    'proposal-invalid',
    'prompt-injection',
    'stream-exception',
    'AI_DISABLED',
    'AI_UNAVAILABLE',
  ];

  it.each(MAPPED_CODES)('서버 코드 %s 에 고객용 문구가 있다', (code) => {
    expect(src(), `${code} 가 매핑돼 있지 않다`).toContain(code);
  });

  /*
     ★★ HTTP 오류 경로(onError)도 확인한다. 여기가 'HTTP 403' 을 만들었다.

       스트림 이벤트가 아니라 fetch 응답 오류는 onError 로 오므로, onEvent 만 고치면
       같은 노출이 남는다.
  */
  it('HTTP 오류에도 고객용 문구가 있다', () => {
    const code = src();
    expect(code, '403/CSRF 안내가 없다').toMatch(/HTTP_403|CSRF_FAILED/);
    expect(code, '401 안내가 없다').toMatch(/HTTP_401/);
    expect(code, '네트워크 끊김 안내가 없다').toMatch(/NETWORK/);
  });

  /*
     ★★ 사전에 없는 코드도 안전하게 감싸는지. 이 방어가 없으면 **다음에 추가되는 코드**가
       그대로 새어 나간다 — 지금까지 그렇게 반복됐다.
  */
  it('알 수 없는 코드는 일반 문구로 감싼다 (코드만 노출, 문장은 아님)', () => {
    const code = src();
    expect(code, '일반 문구 폴백이 없다').toMatch(/ai_err_generic/);
  });

  /* ★ 문구가 3개 언어에 모두 있는지. 영어만 있으면 번역 누락으로 키가 그대로 보인다. */
  const KEYS = [
    'ai_err_session', 'ai_err_signin', 'ai_err_disabled', 'ai_err_unavailable',
    'ai_err_network', 'ai_err_ungrounded', 'ai_err_invalid', 'ai_err_injection',
    'ai_err_stream', 'ai_err_generic',
  ];

  it('오류 문구가 3개 언어에 모두 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = read(`../../../../src/locales/${loc}.js`);
      for (const k of KEYS) {
        expect(dict, `${loc} 사전에 ${k} 가 없다`).toContain(`${k}:`);
      }
    }
  });

  /*
     ★★ 개수를 하드코딩한 거짓 문구가 되살아나지 않는지.

       ai_tool_signal('5 overlays created') / ai_tool_sr('2 levels added') 둘 다
       사실과 다른 개수를 말했다. 사용처를 없앤 뒤에도 사전에 남아 있으면 다음 사람이
       "이미 있는 문구" 라고 생각해 다시 쓴다 — 그것이 이 사고의 발생 경로였다.
  */
  it('개수를 하드코딩한 거짓 문구가 사전에 없다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = stripComments(read(`../../../../src/locales/copilot.${loc}.js`));
      expect(dict, `${loc}: ai_tool_signal 이 되살아났다`).not.toMatch(/ai_tool_signal\s*:/);
      expect(dict, `${loc}: ai_tool_sr 이 되살아났다`).not.toMatch(/ai_tool_sr\s*:/);
    }
  });

  /*
     ★★ 숨기기가 삭제로 되돌아가지 않는지.

       hideOverlay 와 deleteOverlay 가 같은 처리로 묶여 있어서 "숨겨줘" 가 선을 지웠다.
       되돌릴 방법이 없다.
  */
  it('숨기기가 삭제하지 않는다', () => {
    const code = src();
    const at = code.indexOf("case 'hideOverlay'");
    expect(at, 'hideOverlay 분기가 없다').toBeGreaterThan(0);
    const seg = code.slice(at, code.indexOf("case 'deleteOverlay'", at));
    expect(seg, '숨기기가 여전히 삭제한다').not.toMatch(/_removeOverlay/);
    expect(seg, '숨김 표시를 하지 않는다').toMatch(/hidden:\s*true/);
  });

  /*
     ★ 모르는 명령을 조용히 무시하지 않는지. null 을 돌려주면 대화에 아무것도 남지 않아
       고객에게는 AI 가 요청을 무시한 것으로 보인다.
  */
  it('모르는 차트 명령을 조용히 무시하지 않는다', () => {
    const code = src();
    const at = code.lastIndexOf('default:');
    expect(at).toBeGreaterThan(0);
    const seg = code.slice(at, at + 200);
    expect(seg, 'default 가 null 을 돌려준다 — 조용히 사라진다').not.toMatch(/^\s*default:\s*\n?\s*return null;/);
    expect(seg, '무엇이 안 됐는지 말하지 않는다').toMatch(/ai_cmd_unknown/);
  });
});
