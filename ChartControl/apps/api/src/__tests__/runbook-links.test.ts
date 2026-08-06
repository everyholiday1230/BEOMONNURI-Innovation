import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BL-02 remediation — every CloudWatch alarm runbook link in alerting.tf must resolve to an existing
 * file AND an existing anchor. This is the automated guard the audit asked for: a broken on-call link
 * (the original finding: 21 alarms pointed at a non-existent docs/PHASE7-16-INCIDENT-RESPONSE.md) now
 * fails the build instead of being discovered during an incident.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..'); // apps/api/src/__tests__ -> repo root
const ALERTING_TF = join(REPO, 'infrastructure', 'terraform', 'phase7', 'alerting.tf');

/** GitHub-style heading slug: lowercase, strip non-alphanumeric except space/hyphen, spaces->hyphen. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(md: string): Set<string> {
  const out = new Set<string>();
  for (const line of md.split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(slug(m[1]!));
  }
  return out;
}

describe('BL-02 alarm runbook links resolve', () => {
  const tf = readFileSync(ALERTING_TF, 'utf8');

  // Resolve `local.runbook_base = "docs/..."`.
  const baseMatch = /runbook_base\s*=\s*"([^"]+)"/.exec(tf);

  it('alerting.tf declares a runbook_base', () => {
    expect(baseMatch, 'runbook_base not found in alerting.tf').toBeTruthy();
  });

  const runbookRel = baseMatch![1]!;
  const runbookPath = join(REPO, runbookRel);

  it(`runbook file exists: ${runbookRel}`, () => {
    expect(existsSync(runbookPath), `${runbookRel} does not exist`).toBe(true);
  });

  // Extract every `#anchor` used in an alarm description.
  const anchors = [...tf.matchAll(/runbook_base\}#([a-z0-9-]+)/g)].map((m) => m[1]!);

  it('extracts the expected number of alarm anchors', () => {
    // 21 CloudWatch alarms each carry one runbook anchor.
    expect(anchors.length).toBe(21);
    expect(new Set(anchors).size).toBe(21); // all distinct
  });

  it('every alarm anchor resolves to a heading in the runbook (no broken #anchor)', () => {
    const md = readFileSync(runbookPath, 'utf8');
    const slugs = headingSlugs(md);
    const missing = [...new Set(anchors)].filter((a) => !slugs.has(a));
    expect(missing, `runbook anchors with no matching heading: ${missing.join(', ')}`).toEqual([]);
  });

  it('the runbook is real content, not empty placeholder headings', () => {
    const md = readFileSync(runbookPath, 'utf8');
    // Each anchor section must carry a non-trivial body (guard against empty-heading padding).
    const sections = md.split(/^##\s+/m).slice(1);
    const thin = sections.filter((s) => s.replace(/\s+/g, ' ').trim().length < 120).map((s) => s.split('\n')[0]);
    expect(thin, `runbook sections too thin to be a real procedure: ${thin.join(' | ')}`).toEqual([]);
  });
});
