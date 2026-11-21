import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(new URL('./route-cases.json', import.meta.url), 'utf8'));

test('image route records documented image types and evidence class', () => {
  const route = fixture.routes.find(item => item.case === 'image-input');
  assert.deepEqual(route.documentedImageTypes, ['PNG', 'JPEG', 'WebP', 'GIF']);
  assert.match(route.evidence, /offline tests use fake Gemini/);
});

test('YOLO native loop is not labeled host-approved or host-controlled', () => {
  const route = fixture.routes.find(item => item.case === 'host-controlled-tools');
  assert.equal(route.geminiApprovalMode, 'yolo');
  assert.equal(route.hostBridge, false);
  assert.equal(route.decision, 'reject-as-host-controlled-route');
});

test('read-only review route stays blocked without enforced containment evidence', () => {
  const route = fixture.routes.find(item => item.case === 'independent-read-only-review');
  assert.equal(route.hostApprovalEnforced, false);
  assert.equal(route.osIsolationVerified, false);
  assert.equal(route.decision, 'blocked-unverified-containment');
});

test('quota reporting contains only observed counters', () => {
  const quota = fixture.quotaEvidence;
  assert.equal(quota.nativeGeminiSubagentDispatchesRequested, 1);
  assert.equal(quota.tokenCountsObserved, false);
  assert.equal(quota.priceObserved, false);
  assert.equal(quota.remainingQuotaObserved, false);
  assert.equal(quota.latencyMeasured, false);
});
