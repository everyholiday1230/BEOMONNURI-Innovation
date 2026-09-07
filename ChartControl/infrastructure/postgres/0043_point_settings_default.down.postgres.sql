/*
   되돌리기.

   ★ 기본 행을 지운다. 다만 **운영자가 값을 바꿔 둔 경우에는 지우지 않는다** —
     version > 0 이면 설정 화면에서 저장한 적이 있다는 뜻이고, 그것을 마이그레이션
     되돌리기가 삭제하면 설정이 사라진다.
*/
DELETE FROM point_settings WHERE id = 'default' AND version = 0;
