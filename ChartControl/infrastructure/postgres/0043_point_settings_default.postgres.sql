/*
   point_settings 기본 행을 보장한다.

   ★★ 왜 필요한가

     `point_settings` 에 행이 없으면 `getSettings()` 가 **enabled:false 로 떨어진다.**
     그 결과 모든 포인트 기능이 조용히 아무 일도 하지 않는다 — 가입 지급, 초대 보상,
     차감, 구매 전부. 오류도 없고 로그도 없다. 설정 화면을 한 번도 저장하지 않은
     배포에서는 포인트 제도가 "켜져 있다고 생각하는데 실제로는 없는" 상태가 된다.

     실제로 겪었다: 로컬 Postgres 를 새로 만들고 가입했을 때 지급이 되지 않았고,
     원인이 이 빈 테이블이었다.

   ★ 값은 **안전한 기본**으로 넣는다. enabled=false, purchase_enabled=false.
     제도를 켜는 것은 운영자의 결정이고 마이그레이션이 대신할 일이 아니다. 다만
     행이 존재하면 설정 화면에서 켤 수 있고, 서버가 "행이 없어서 꺼짐" 과 "운영자가
     꺼둠" 을 구별할 수 있다.

   ★ 이미 행이 있으면 건드리지 않는다(ON CONFLICT DO NOTHING). 운영 중인 배포의
     설정을 마이그레이션이 되돌리면 안 된다 — 지금 운영 DB 는 enabled=true 다.
*/
INSERT INTO point_settings (id, enabled, unit_name, purchase_enabled, expiry_days, referral_as_points, referral_points, version)
VALUES ('default', FALSE, 'Points', FALSE, 0, FALSE, 0, 0)
ON CONFLICT (id) DO NOTHING;
