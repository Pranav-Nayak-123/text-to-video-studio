import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyOutput } from '../engine/render/verify.mjs';
import { DEFAULT_OUTPUT, isRenderOf } from '../engine/render/render.mjs';
import { planExists, loadPlan } from '../engine/plan/store.mjs';

/**
 * Acceptance tests for the rendered video. They run the same verification the
 * web application runs after a generation.
 *
 * They are skipped unless a video exists that was rendered from the plan
 * currently loaded. Checking a video of one story against the plan of another
 * proves nothing, and on a fresh checkout there is no video at all.
 */
const ready = planExists() && fs.existsSync(DEFAULT_OUTPUT) && isRenderOf(loadPlan());

describe('rendered video', { skip: ready ? false : 'no video rendered from the current plan — run "npm run story -- <file> --render"' }, () => {
  let report;

  before(async () => { report = await verifyOutput({ file: DEFAULT_OUTPUT }); });

  test('every verification check passes', () => {
    const failed = report.failed.map((c) => `${c.name} (${c.detail})`);
    assert.deepEqual(failed, [], `failing checks:\n  ${failed.join('\n  ')}`);
  });

  test('the video matches the plan it was rendered from', () => {
    const planned = report.plan.totals.seconds;
    assert.ok(Math.abs(report.duration - planned) < 0.4,
      `video is ${report.duration.toFixed(2)}s, plan says ${planned}s`);
  });

  test('the verification is substantive', () => {
    assert.ok(report.checks.length >= 18,
      `only ${report.checks.length} checks ran — the verifier may have short-circuited`);
  });
});
