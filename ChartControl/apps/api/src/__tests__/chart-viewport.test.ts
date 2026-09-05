import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   과거를 볼 때 차트가 튀지 않는다.

   ★★ 재현한 결함 (운영자 신고 → 실측)

     과거로 스크롤한 뒤 3초 간격으로 가시 범위를 읽었더니 계속 튀었다:

       48→86 · 192→230 · 84→122 · 228→266 · 120→158   (6회 관찰, 6회 전부 튐)

     이 상태로는 과거 구간을 읽을 수 없다. 차트 분석 도구인데 차트를 볼 수 없다.

   ★★ 원인

     candles 배열이 5초마다 새 객체로 오고(시세 폴링), 마지막 봉의 종가가 바뀌므로
     지문이 달라진다. 그러면 `chart.resetData()` 를 부른다. resetData 는 데이터를
     통째로 버리고 **데이터 로더를 다시 호출한다.** 로더는 비동기이므로 그 직후에
     scrollToTimestamp 로 위치를 복원해도, 로더 응답이 도착하면 뷰가 최신으로 다시
     밀린다. 복원과 로더가 매 갱신마다 경쟁했다.

   ★★ 부분 갱신 API 가 없다는 사실을 실측으로 확인했다.

     차트 인스턴스의 메서드를 전부 나열해 보니 데이터 계열은
     resetData · getDataList · setDataLoader · scrollToDataIndex · zoomAtDataIndex
     뿐이다. updateData/appendData/applyNewData 계열은 이 KLineCharts 버전에 없다.
     처음에는 updateData 로 마지막 봉만 갈아끼우려 했는데, 그 메서드가 없어서
     조용히 폴백돼 아무것도 나아지지 않았다(계측: 'updateData 없음' 후 reset 14회).

   ★★ 그래서 선택을 바꿨다: 과거를 보는 동안 실시간 갱신을 **미룬다.**

     과거를 분석하는 중에 최신 봉이 갱신될 필요는 없다. 오른쪽 끝으로 돌아오면
     그때 최신 데이터로 다시 그린다. 데이터를 버리는 것이 아니라 그리는 시점을
     미루는 것이다.

   ★ 실측 결과
       과거 위치 고정: 24초 관찰 동안 from=24 그대로, resetData 호출 0회, 튐 0/8
       복귀 시 갱신 재개: 마지막 종가 68,063.57 → 67,971.24
*/
describe('CHART-VIEWPORT — 과거를 볼 때 화면이 고정된다', () => {
  const src = read('src/chart-kline.jsx');

  it('[1] 과거를 보는 중이고 마지막 봉만 바뀌면 다시 그리지 않는다', () => {
    /*
       ★ 두 조건이 모두 필요하다. 구조가 바뀐 경우(심볼·주기 변경, 과거 추가 적재)
         에는 다시 그려야 하고, 최신을 보고 있으면 실시간 갱신이 정상이다.
    */
    expect(src).toMatch(/const onlyLastBarChanged = sameKey/);
    expect(src).toMatch(/if \(onlyLastBarChanged && anchorTs != null\) \{/);
    expect(src).toMatch(/pendingLiveRef\.current = true;/);
  });

  it('[2] 앵커가 없으면(최신을 보는 중) 미루지 않는다', () => {
    /*
       ★★ anchorTs 는 "오른쪽 끝을 보고 있지 않다" 는 뜻으로만 설정된다. 그 조건을
         빼면 실시간 관찰 중에도 갱신이 멈춰, 가격이 굳은 차트를 보게 된다 —
         그건 튀는 것보다 위험하다(고객이 멈춘 가격으로 주문한다).
    */
    const block = src.slice(src.indexOf('let anchorTs = null;'), src.indexOf('const onlyLastBarChanged'));
    expect(block).toMatch(/to < dl\.length - 1/);
  });

  it('[3] 구조가 바뀌면 여전히 다시 그리고 위치를 복원한다', () => {
    expect(src).toMatch(/chart\.resetData\(\);/);
    expect(src).toMatch(/chart\.scrollToTimestamp\(anchorTs, 0\)/);
  });

  it('[4] 미뤘다는 사실을 기억한다', () => {
    /*
       ★ 미룬 것을 잊으면 사용자가 최신으로 돌아와도 낡은 마지막 봉이 남는다.
    */
    expect(src).toMatch(/const pendingLiveRef = useRef\(false\);/);
  });

  it('[5] 없는 API 에 의존하지 않는다', () => {
    /*
       ★★ 이 KLineCharts 버전에는 updateData/appendData 계열이 없다(실측). 그런
         메서드를 부르는 코드는 조용히 폴백돼 아무 효과가 없다 — 고치지 않은 채
         고쳤다고 믿게 되는 경로다.
    */
    for (const absent of ['chart.updateData', 'chart.appendData', 'chart.applyNewData']) {
      expect(src, `${absent} 는 이 라이브러리에 없다`).not.toContain(absent);
    }
  });

  it('[6] 라이브러리에 실제로 그 API 가 없다는 전제를 검증한다', () => {
    /*
       ★ 전제가 바뀌면(라이브러리 업그레이드로 부분 갱신이 생기면) 이 검사가 먼저
         알려준다. 그때는 미루는 방식 대신 부분 갱신으로 바꾸는 것이 낫다.
    */
    const lib = read('vendor/klinecharts/klinecharts.min.js');
    expect(lib).toContain('resetData');
    for (const absent of ['updateData', 'appendData', 'applyNewData']) {
      expect(lib, `라이브러리에 ${absent} 가 생겼다 — 부분 갱신으로 바꿀 수 있다`).not.toContain(absent);
    }
  });
});
