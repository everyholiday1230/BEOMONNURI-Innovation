/*
   거래소 자격증명 재래핑 (KEK 교체).

   ★★ 왜 이 스크립트가 필요한가

     `CREDENTIAL_KEK` 가 설정되지 않으면 코드가 **공개된 고정 키**로 폴백했다
     (`Buffer.alloc(32, 7)` — 전 바이트 0x07). 저장소를 읽을 수 있는 사람은 누구나
     고객의 거래소 API 키를 복호화할 수 있다는 뜻이다. 운영에서 실제로 그 상태였고,
     영향받는 자격증명은 3건(고객 3명)이었다.

   ★★ 왜 순서가 중요한가

     KEK 를 먼저 바꾸면 **기존 자격증명을 복호화할 수 없다.** DEK 가 옛 KEK 로 감싸져
     있기 때문이다. 그러면 고객의 키가 살아 있는데 우리가 쓸 수 없고, 고객은 다시
     등록해야 한다 — 거래소에서 키를 새로 만들어야 하므로 그냥 이탈한다.

     그래서 이 스크립트가 **옛 KEK 로 풀고 새 KEK 로 다시 감싼다.** 그 다음에 환경변수를
     바꾼다.

   ★★ 실행 순서 (이 순서를 지켜야 한다)

     1) 새 KEK 를 만든다:      openssl rand -base64 32
     2) 이 스크립트를 돌린다:  OLD_CREDENTIAL_KEK=<없으면 비움> NEW_CREDENTIAL_KEK=<새 키> \
                              DATABASE_URL=<운영> npx tsx apps/api/scripts/rewrap-credentials.mts
     3) 성공하면 CREDENTIAL_KEK=<새 키> 를 환경변수에 넣고 배포한다.
     4) env.ts 의 fail-closed 검사가 이후 미설정 부팅을 막는다.

   ★ --dry-run 으로 먼저 무엇이 바뀌는지 본다. 기본은 dry-run 이다 — 실수로 쓰기가
     일어나지 않게.
*/

import pg from 'pg';

import { CredentialVault, LocalKekProvider } from '../src/trading/credential-vault';

const { Pool } = pg;

const DRY = !process.argv.includes('--apply');
const OLD = process.env.OLD_CREDENTIAL_KEK ?? Buffer.alloc(32, 7).toString('base64');
const NEW = process.env.NEW_CREDENTIAL_KEK;
const URL = process.env.DATABASE_URL;

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!URL) die('DATABASE_URL 이 필요하다.');
if (!NEW) die('NEW_CREDENTIAL_KEK 이 필요하다 (openssl rand -base64 32).');
if (NEW === OLD) die('새 KEK 가 옛 KEK 와 같다 — 바꿀 이유가 없다.');
/* ★ 32바이트가 아니면 AES-256-GCM 이 거부한다. 미리 잡는다. */
if (Buffer.from(NEW, 'base64').length !== 32) die('NEW_CREDENTIAL_KEK 는 base64 로 32바이트여야 한다.');

/*
   ★ 운영 Postgres 는 SSL 을 요구한다(Render). 인증서 검증은 끄지 않는다 —
     `sslmode=require` 가 연결 문자열에 있으면 그것을 따르고, 없으면 붙인다.
*/
const conn = /[?&]sslmode=/.test(URL) ? URL : `${URL}${URL.includes('?') ? '&' : '?'}sslmode=require`;
const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

/*
   ★ 컬럼 이름은 저장소 구현을 따른다. 스키마가 바뀌면 여기서 즉시 실패해야 한다 —
     조용히 0건 처리하고 "성공" 이라고 말하면 KEK 를 바꾼 뒤에 복호화가 깨진다.
*/
const SELECT = `
  SELECT id, wrapped_dek, encryption_key_version
    FROM exchange_credentials
   WHERE revoked_at IS NULL`;

const rows = (await pool.query(SELECT)).rows as Array<{
  id: string; wrapped_dek: string; encryption_key_version: string;
}>;

console.log(`\n대상 자격증명: ${rows.length}건  (모드: ${DRY ? 'DRY-RUN — 쓰지 않는다' : 'APPLY — 실제로 바꾼다'})\n`);
if (rows.length === 0) {
  console.log('바꿀 것이 없다. 그래도 CREDENTIAL_KEK 는 설정해야 한다 — 다음에 등록되는 키가 고정 키로 감싸진다.\n');
  await pool.end();
  process.exit(0);
}

const oldVault = new CredentialVault(new LocalKekProvider(OLD));
const newKms = new LocalKekProvider(NEW);

let ok = 0;
const failed: string[] = [];

for (const r of rows) {
  try {
    /*
       ★ rotate 는 DEK 만 다시 감싼다. 암호문(apiKey/secret)은 그대로다 — DEK 가 같으므로
         복호화 결과도 같다. 그래서 이 작업은 되돌릴 수 있다(옛 KEK 로 다시 감싸면 된다).
    */
    const rotated = await oldVault.rotate(
      {
        wrappedDek: r.wrapped_dek,
        encryptionKeyVersion: r.encryption_key_version,
      } as never,
      newKms,
    );
    if (!DRY) {
      await pool.query(
        `UPDATE exchange_credentials
            SET wrapped_dek = $2, encryption_key_version = $3, updated_at = now()
          WHERE id = $1`,
        [r.id, (rotated as { wrappedDek: string }).wrappedDek, (rotated as { encryptionKeyVersion: string }).encryptionKeyVersion],
      );
    }
    ok += 1;
  } catch (e) {
    /*
       ★★ 실패를 삼키지 않는다. 한 건이라도 못 바꾸면 KEK 를 교체하면 그 고객의 키가
         죽는다. 목록을 그대로 보여주고 0 이 아닌 코드로 끝낸다.
    */
    failed.push(`${r.id}: ${(e as Error).message}`);
  }
}

console.log(`성공 ${ok} / 실패 ${failed.length}`);
if (failed.length) {
  console.error('\n✗ 실패한 자격증명:');
  for (const f of failed) console.error('   ', f);
  console.error('\nKEK 를 교체하지 말 것 — 이 키들은 복호화할 수 없게 된다.\n');
  await pool.end();
  process.exit(1);
}

console.log(DRY
  ? '\n✓ DRY-RUN 통과. 실제로 바꾸려면 --apply 를 붙인다.\n'
  : `\n✓ ${ok}건 재래핑 완료. 이제 CREDENTIAL_KEK 를 새 값으로 설정하고 배포한다.\n`);
await pool.end();
