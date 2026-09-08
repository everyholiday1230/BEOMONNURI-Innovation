/**
 * 복구본에서 **고객 거래소 자격증명이 실제로 복호화되는지** 확인한다.
 *
 * ★★ 왜 이것이 백업 검증의 핵심인가
 *
 *   행 수가 맞아도 키를 풀 수 없으면 그 백업으로 서비스를 되살릴 수 없다. 고객은
 *   거래소 API 키를 다시 발급해 등록해야 하고, 그 사이 아무도 주문을 낼 수 없다.
 *   "백업이 있다" 와 "백업으로 되살릴 수 있다" 는 다른 말이다.
 *
 * ★ 복호화된 값을 **출력하지 않는다.** 앞 4자와 길이만 남긴다 — 검증 로그가
 *   그 자체로 유출 경로가 되면 안 된다.
 *
 * ★ **apps/api 안에 둔다.** `pg` 와 TypeScript 소스가 이 워크스페이스에 있어서,
 *   저장소 루트(tools/)에 두면 `Cannot find package 'pg'` 로 멈춘다.
 *
 * ★ 자격증명이 0건이면 성공으로 다루지 않는다. 검증할 것이 없는 상태를 "통과" 로
 *   보고하면, 복구가 자격증명을 빠뜨렸을 때 그대로 넘어간다.
 */
import pg from 'pg';

import { CredentialVault, LocalKekProvider } from '../src/trading/credential-vault';

const url = process.env.RESTORED_URL;
const kek = process.env.CREDENTIAL_KEK;
if (!url || !kek) {
  console.error('RESTORED_URL 과 CREDENTIAL_KEK 이 필요하다.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url });
const vault = new CredentialVault(new LocalKekProvider(kek));

const { rows } = await pool.query(
  `SELECT exchange, access_key_masked, encrypted_access_key, encrypted_secret_key,
          encrypted_memo, wrapped_dek, encryption_key_version, algo
     FROM exchange_credentials`,
);

console.log(`  복구본 자격증명 ${rows.length}건`);
let ok = 0;
for (const r of rows) {
  try {
    const c = await vault.decrypt({
      accessKeyMasked: r.access_key_masked,
      encryptedAccessKey: r.encrypted_access_key,
      encryptedSecretKey: r.encrypted_secret_key,
      encryptedMemo: r.encrypted_memo,
      wrappedDek: r.wrapped_dek,
      encryptionKeyVersion: r.encryption_key_version,
      algo: r.algo,
    });
    const k = String(c.accessKey ?? '');
    /* ★ 앞 4자와 길이만. 전체 값을 찍으면 검증 로그가 유출 경로가 된다. */
    console.log(`    ${r.exchange} → 키 앞4=${k.slice(0, 4)}… 길이=${k.length} ✓`);
    ok += 1;
  } catch (e) {
    console.log(`    ${r.exchange} → 복호화 실패: ${e.message}`);
  }
}
await pool.end();

if (rows.length === 0) {
  console.error('  ★ 자격증명이 0건이다. 복구가 이 표를 빠뜨렸는지 확인할 것 — 검증하지 못했다.');
  process.exit(1);
}
if (ok !== rows.length) {
  console.error(`  ★ 복호화 실패 (${ok}/${rows.length}) — 이 백업으로는 서비스를 되살릴 수 없다.`);
  process.exit(1);
}
console.log(`  전부 복호화 성공 (${ok}/${rows.length}) — 이 백업으로 서비스를 되살릴 수 있다.`);
