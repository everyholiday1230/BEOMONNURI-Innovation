/**
 * 모든 도구(function) 스키마가 OpenAI 가 받아들이는 형태인지 검사한다.
 *
 * ★★★ 왜 이 시험이 필요한가 — 이것이 없어서 AI 기능 전체가 죽었다
 *
 *   `zodToJsonSchema` 가 `ZodDefault`(예: `z.array(...).default([])`)를 몰랐다.
 *   모르는 타입은 `return {}` 로 떨어져 **type 키가 없는 빈 스키마**가 됐다.
 *   OpenAI 는 함수 정의를 검증하므로 즉시 거절한다:
 *
 *     400 Invalid schema for function 'review_setup':
 *     In context=('properties','sides','items','properties','targets'),
 *     schema must have a 'type' key.
 *
 *   함수 정의 하나가 잘못되면 **그 호출 전체가 실패한다.** 즉 AI 가 통째로 안 된다.
 *   프로덕션 로그에서 확인했다(2026-09-09 14:56).
 *
 * ★ 이 시험은 모든 스키마를 실제로 변환해 **모든 노드에 type 이 있는지** 본다.
 *   단위 시험으로 잡을 수 있는 종류였는데 없었다.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, ToolRegistry } from '../tools';

/** JSON Schema 를 재귀로 훑어 type 이 빠진 노드를 모은다. */
function nodesWithoutType(node: unknown, path: string[] = []): string[] {
  if (!node || typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const bad: string[] = [];

  /* enum 만 있는 노드도 OpenAI 는 type 을 요구한다. */
  if (!('type' in o) && !('$ref' in o) && !('anyOf' in o) && !('oneOf' in o)) {
    bad.push(path.join('.') || '(root)');
  }
  if (o.properties && typeof o.properties === 'object') {
    for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) {
      bad.push(...nodesWithoutType(v, [...path, 'properties', k]));
    }
  }
  if (o.items) bad.push(...nodesWithoutType(o.items, [...path, 'items']));
  return bad;
}

describe('도구 스키마 — OpenAI 가 받아들이는 형태여야 한다', () => {
  it('★★★ 모든 도구 정의에 type 없는 노드가 없다', () => {
    /*
       ★ 하나라도 빠지면 그 함수를 포함한 **모든 AI 호출이 400 으로 실패한다.**
         부분 장애가 아니라 전체 장애다.
    */
    /* ★ 실제 서버가 쓰는 경로 그대로 만든다. 데이터원은 쓰이지 않는다(list 만 호출). */
    const reg = new ToolRegistry({} as never);
    const defs = reg.list();
    expect(defs.length, '도구 정의가 없다').toBeGreaterThan(0);
    const problems: string[] = [];
    for (const d of defs) {
      for (const p of nodesWithoutType(d.parameters)) problems.push(`${d.name}: ${p}`);
    }
    expect(problems, `type 이 없는 노드:\n${problems.join('\n')}`).toEqual([]);
  });

  it('★ ZodDefault 를 내부 타입으로 펼친다', () => {
    /* ★★ 바로 이것이 빠져 있었다. `.default([])` 가 붙은 배열이 빈 스키마가 됐다. */
    const out = zodToJsonSchema(z.array(z.string()).default([])) as { type?: string; items?: unknown };
    expect(out.type).toBe('array');
    expect(out.items).toEqual({ type: 'string' });
  });

  it('중첩된 ZodDefault 도 펼친다', () => {
    const inner = z.object({ targets: z.array(z.string()).max(3).default([]) });
    const out = zodToJsonSchema(z.array(inner)) as {
      type?: string; items?: { properties?: { targets?: { type?: string } } };
    };
    expect(out.type).toBe('array');
    expect(out.items?.properties?.targets?.type, 'targets 에 type 이 없다').toBe('array');
  });

  it('optional·nullable 도 그대로 동작한다', () => {
    expect((zodToJsonSchema(z.string().optional()) as { type?: string }).type).toBe('string');
    const n = zodToJsonSchema(z.string().nullable()) as { type?: unknown };
    expect(n.type).toEqual(['string', 'null']);
  });

  it('ZodEffects(.refine/.transform)도 펼친다', () => {
    /*
       ★★ 이것도 처리되지 않아 빈 스키마가 됐다. `throw` 로 바꾸자마자 기존 시험이
         곧바로 잡아냈다 — 그전에는 조용히 잘못된 정의가 만들어지고 있었다.
    */
    const out = zodToJsonSchema(
      z.object({ a: z.string() }).refine(() => true),
    ) as { type?: string; properties?: Record<string, unknown> };
    expect(out.type).toBe('object');
    expect(out.properties?.a).toEqual({ type: 'string' });
  });

  it('★★ 모르는 타입은 조용히 넘기지 않고 던진다', () => {
    /*
       ★★★ 예전에는 `return {}` 였다. 그래서 새 zod 타입을 쓰는 순간 경고 없이
         잘못된 함수 정의가 만들어지고 **AI 전체가 죽었다.** 던지면 시험·부팅에서
         즉시 드러난다 — 고객 앞에서 죽는 것보다 낫다.
    */
    expect(() => zodToJsonSchema(z.tuple([z.string()]))).toThrow(/처리하지 않는 zod 타입/);
  });
});
