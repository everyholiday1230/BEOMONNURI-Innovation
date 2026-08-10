/**
 * 고객 지원 티켓 저장소 테스트.
 *
 * 여기서 지키는 것은 하나다: **내부 메모가 고객에게 새지 않는다.**
 * 한 번 새면 되돌릴 수 없다 — 고객이 이미 읽었다. 그래서 조회 함수를
 * 두 개로 나눴고(getForCustomer / getForStaff), 그 분리가 실제로 동작하는지
 * 확인한다.
 *
 * 두 번째로 지키는 것: 상태 전이가 대응 흐름과 맞는다. 상태가 틀리면
 * 답장이 필요한 티켓이 "처리됨" 으로 묻히고 고객은 답을 못 받는다.
 */

import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PgSupportRepo } from '../db/support-repo';

const URL = process.env.PG_TEST_URL;
const d = URL ? describe : describe.skip;

d('PgSupportRepo', () => {
  let pool: Pool;
  let repo: PgSupportRepo;
  let customer: string;
  let other: string;
  let staff: string;

  const mkUser = async (role: string) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', $3, 'active') ON CONFLICT DO NOTHING`,
      [id, `support-${id.slice(0, 8)}@test.local`, role],
    );
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    repo = new PgSupportRepo(pool);
    customer = await mkUser('USER');
    other = await mkUser('USER');
    staff = await mkUser('SUPPORT');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM support_tickets');
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[customer, other, staff]]);
    await pool.end();
  });

  beforeEach(async () => {
    // 메시지는 ON DELETE CASCADE 로 함께 지워진다.
    await pool.query('DELETE FROM support_tickets');
  });

  const newTicket = () =>
    repo.create({
      userId: customer,
      userEmail: 'c@test.local',
      subject: 'API 키 연결 실패',
      body: '400004 오류가 납니다.',
    });

  it('티켓을 만들면 첫 메시지가 함께 남는다 — 본문 없는 빈 티켓이 생기지 않는다', async () => {
    const t = await newTicket();
    expect(t.status).toBe('open');
    expect(t.priority).toBe('medium');

    const staffView = await repo.getForStaff(t.id);
    expect(staffView?.messages).toHaveLength(1);
    expect(staffView?.messages[0]!.authorSide).toBe('customer');
    expect(staffView?.messages[0]!.internal).toBe(false);
  });

  it('내부 메모는 고객 조회에서 제외된다', async () => {
    const t = await newTicket();
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '내부: 키 재발급 안내 예정', internal: true });

    const staffView = await repo.getForStaff(t.id);
    const custView = await repo.getForCustomer(t.id, customer);

    expect(staffView?.messages).toHaveLength(2);
    // 고객은 자기 글만 본다. 내부 메모는 없다.
    expect(custView?.messages).toHaveLength(1);
    expect(custView?.messages.some((m) => m.internal)).toBe(false);
  });

  it('내부 메모와 답장이 섞여 있어도 고객은 답장만 본다', async () => {
    const t = await newTicket();
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '내부 1', internal: true });
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '고객 답장', internal: false });
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '내부 2', internal: true });

    const custView = await repo.getForCustomer(t.id, customer);
    expect(custView?.messages.map((m) => m.body)).toEqual(['400004 오류가 납니다.', '고객 답장']);
  });

  it('남의 티켓은 열 수 없다 — 소유 확인을 저장소가 한다', async () => {
    const t = await newTicket();
    // 라우트에서만 확인하면 다른 호출 경로가 생길 때 빠뜨린다.
    expect(await repo.getForCustomer(t.id, other)).toBeNull();
    // 본인은 열린다.
    expect(await repo.getForCustomer(t.id, customer)).not.toBeNull();
  });

  it('운영자가 답하면 고객 답변 대기(pending)로 바뀐다', async () => {
    const t = await newTicket();
    expect(t.status).toBe('open');

    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '안내드립니다', internal: false });
    expect((await repo.getTicket(t.id))?.status).toBe('pending');
  });

  it('고객이 답하면 다시 열림(open)이 된다 — 우리가 볼 차례다', async () => {
    const t = await newTicket();
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '안내', internal: false });
    expect((await repo.getTicket(t.id))?.status).toBe('pending');

    await repo.addMessage({ ticketId: t.id, authorUserId: customer, authorSide: 'customer', body: '아직 안 됩니다', internal: false });
    expect((await repo.getTicket(t.id))?.status).toBe('open');
  });

  it('내부 메모는 상태를 바꾸지 않는다 — 메모만 남기고 처리된 것처럼 보이면 안 된다', async () => {
    const t = await newTicket();
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '내부 검토중', internal: true });

    // 답장하지 않았으므로 여전히 우리가 볼 차례다.
    expect((await repo.getTicket(t.id))?.status).toBe('open');
  });

  it('종료된 티켓에 새 메시지가 오면 다시 열린다 — 추가 문의가 묻히지 않는다', async () => {
    const t = await newTicket();
    await repo.setStatus(t.id, 'resolved');
    const resolved = await repo.getTicket(t.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeTypeOf('number');

    await repo.addMessage({ ticketId: t.id, authorUserId: customer, authorSide: 'customer', body: '또 문제가 생겼습니다', internal: false });
    const reopened = await repo.getTicket(t.id);
    expect(reopened?.status).toBe('open');
    // 종료 시각도 지워진다 — 열린 티켓에 종료 시각이 남아 있으면 집계가 틀린다.
    expect(reopened?.resolvedAt).toBeNull();
  });

  it('메시지가 오면 갱신 시각이 올라간다 — 목록에서 묻히지 않는다', async () => {
    const t = await newTicket();
    await new Promise((r) => setTimeout(r, 30));
    await repo.addMessage({ ticketId: t.id, authorUserId: customer, authorSide: 'customer', body: '추가 정보', internal: false });

    const after = await repo.getTicket(t.id);
    expect(after!.updatedAt).toBeGreaterThan(t.updatedAt);
  });

  it('목록은 열린 것부터 보여준다', async () => {
    const a = await newTicket();
    const b = await newTicket();
    await repo.setStatus(a.id, 'resolved');

    const rows = await repo.listAll();
    // 종료된 것이 뒤로 간다 — 처리할 것이 먼저 보여야 한다.
    expect(rows[0]!.id).toBe(b.id);
    expect(rows[rows.length - 1]!.id).toBe(a.id);
  });

  it('사용자는 자기 티켓만 목록에 나온다', async () => {
    await newTicket();
    await repo.create({ userId: other, userEmail: 'o@test.local', subject: '남의 문의', body: 'x' });

    const mine = await repo.listForUser(customer);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe('API 키 연결 실패');
  });

  it('사용자 목록의 메시지 수에 내부 메모가 포함되지 않는다', async () => {
    const t = await newTicket();
    await repo.addMessage({ ticketId: t.id, authorUserId: staff, authorSide: 'staff', body: '내부', internal: true });

    const mine = await repo.listForUser(customer);
    // 내부 메모가 세어지면 고객이 "답변 2개" 로 보고 답을 기다린다.
    expect(mine[0]!.messageCount).toBe(1);

    const all = await repo.listAll();
    expect(all[0]!.messageCount).toBe(2);
  });

  it('상태별 건수를 집계한다', async () => {
    const a = await newTicket();
    await newTicket();
    await repo.setStatus(a.id, 'resolved');

    expect(await repo.counts()).toEqual({ open: 1, pending: 0, resolved: 1 });
  });

  it('없는 티켓에 대한 동작은 null 이다 (조용히 성공하지 않는다)', async () => {
    const fake = randomUUID();
    expect(await repo.getTicket(fake)).toBeNull();
    expect(await repo.getForStaff(fake)).toBeNull();
    expect(await repo.setStatus(fake, 'resolved')).toBeNull();
    expect(await repo.setPriority(fake, 'high')).toBeNull();
    expect(await repo.assign(fake, staff)).toBeNull();
    expect(await repo.addMessage({ ticketId: fake, authorUserId: staff, authorSide: 'staff', body: 'x' })).toBeNull();
  });

  it('담당자를 지정하고 해제할 수 있다', async () => {
    const t = await newTicket();
    expect(t.assignedTo).toBeNull();

    expect((await repo.assign(t.id, staff))?.assignedTo).toBe(staff);
    expect((await repo.assign(t.id, null))?.assignedTo).toBeNull();
  });

  it('사용자가 지워져도 티켓과 이메일은 남는다 — 대응 기록은 분쟁 근거다', async () => {
    const doomed = await mkUser('USER');
    const t = await repo.create({ userId: doomed, userEmail: 'gone@test.local', subject: '삭제될 사용자', body: 'x' });

    await pool.query('DELETE FROM users WHERE id = $1', [doomed]);

    const after = await repo.getTicket(t.id);
    expect(after).not.toBeNull();
    expect(after!.userId).toBeNull();
    // 이메일 사본이 있어 누구였는지 알 수 있다.
    expect(after!.userEmail).toBe('gone@test.local');
  });
});
