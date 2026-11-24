// SignBridge 이식 코드 테스트:  node tests/signbridge.test.mjs
// 1~2부는 SignBridge 원본 테스트(web/src/recognition/dtw.test.ts, web/src/vision/normalize.test.ts,
// MIT License, Copyright (c) 2026 SignBridge contributors)를 vitest 없이 Node로 옮긴 것이다.
// 원본 테스트가 그대로 통과하면 이식한 계산이 원본과 같다는 뜻이다. 3부는 우리가 추가한 어댑터 테스트.
import assert from 'node:assert/strict';
import { dtw } from '../web/js/signbridge/dtw.js';
import { normalizeHand, featureDistance, taiwanToFeatures, FULL_FEATURE_SIZE } from '../web/js/signbridge/normalize.js';

let passed = 0;
const it = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

console.log('SignBridge 원본 테스트: dtw');
const fakeFrame = (dim, seed) => Array.from({ length: dim }, (_, i) => Math.sin(seed + i * 0.3) * 0.1);
const dim = 63;
it('같은 시퀀스면 거리 0', () => {
  const a = [fakeFrame(dim, 0), fakeFrame(dim, 1), fakeFrame(dim, 2)];
  const r = dtw(a, a); assert.equal(r.distance, 0); assert.equal(r.normalizedDistance, 0);
});
it('아주 비슷하면 거리가 작다', () => {
  const a = [fakeFrame(dim, 0), fakeFrame(dim, 1), fakeFrame(dim, 2)];
  const b = a.map(f => f.map(v => v + 0.001));
  const r = dtw(a, b); assert.ok(r.distance < 1); assert.ok(r.normalizedDistance < 0.3);
});
it('확실히 다르면 거리가 크다', () => {
  const r = dtw([fakeFrame(dim, 0), fakeFrame(dim, 1)], [fakeFrame(dim, 10), fakeFrame(dim, 11)]);
  assert.ok(r.distance > 0.5); assert.ok(r.normalizedDistance > 0.3);
});
it('빈 시퀀스 처리', () => {
  const r = dtw([], []); assert.equal(r.distance, Infinity); assert.equal(r.normalizedDistance, 1);
  const a = [fakeFrame(dim, 0)];
  assert.equal(dtw(a, []).distance, Infinity); assert.equal(dtw([], a).distance, Infinity);
});
it('경로가 (0,0)에서 시작해 마지막 칸에서 끝난다', () => {
  const a = [fakeFrame(dim, 0), fakeFrame(dim, 1), fakeFrame(dim, 2)], b = [fakeFrame(dim, 0), fakeFrame(dim, 1)];
  const r = dtw(a, b);
  assert.ok(r.path.length >= Math.max(a.length, b.length));
  assert.deepEqual(r.path[0], [0, 0]); assert.deepEqual(r.path[r.path.length - 1], [a.length - 1, b.length - 1]);
});
it('정규화 거리는 1을 넘지 않는다', () => {
  assert.ok(dtw([Array(dim).fill(1)], [Array(dim).fill(-1)]).normalizedDistance <= 1);
});
it('159개 특징(양손 + 상체)에서도 동작', () => {
  const r = dtw([fakeFrame(159, 0), fakeFrame(159, 1)], [fakeFrame(159, 0), fakeFrame(159, 1.5)]);
  assert.ok(r.distance > 0); assert.ok(r.path.length >= 2);
});

console.log('SignBridge 원본 테스트: normalizeHand');
const makeHand = (offset = 0, scale = 1) => Array.from({ length: 21 }, (_, i) => ({
  x: offset + scale * (0.1 + i * 0.01), y: offset + scale * (0.2 + i * 0.02), z: scale * (i * 0.005) }));
const hf = (landmarks, handedness = 'Right') => ({ landmarks, handedness, score: 1 });
it('특징 63개', () => assert.equal(normalizeHand(hf(makeHand())).length, 63));
it('위치가 달라도 같다', () => assert.ok(featureDistance(normalizeHand(hf(makeHand(0))), normalizeHand(hf(makeHand(0.3)))) < 1e-9));
it('크기가 달라도 같다', () => assert.ok(featureDistance(normalizeHand(hf(makeHand(0, 1))), normalizeHand(hf(makeHand(0, 2.5)))) < 1e-9));
it('좌우 반전한 왼손은 오른손과 같다', () => {
  const right = makeHand(), left = right.map(p => ({ ...p, x: 1 - p.x }));
  assert.ok(featureDistance(normalizeHand(hf(right, 'Right')), normalizeHand(hf(left, 'Left'))) < 1e-9);
});
it('손목이 원점', () => { const f = normalizeHand(hf(makeHand())); assert.equal(f[0], 0); assert.equal(f[1], 0); assert.equal(f[2], 0); });
it('관절 수가 틀리면 오류', () => assert.throws(() => normalizeHand(hf(makeHand().slice(0, 5)))));

console.log('[한국어 학습판] 대만 좌표 어댑터');
it('258개 좌표 → 159개 특징, 손 블록 A는 오른손 자리(63~125), B는 왼손 자리(0~62)', () => {
  const f = new Float32Array(258);
  for (let k = 0; k < 33; k++) { f[k * 4] = 0.4 + k * 0.005; f[k * 4 + 1] = 0.3 + k * 0.004; }
  f[11 * 4] = 0.6; f[12 * 4] = 0.4;
  for (let k = 0; k < 21; k++) { f[132 + k * 3] = 0.6 + k * 0.003; f[132 + k * 3 + 1] = 0.5 - k * 0.004; }
  const out = taiwanToFeatures(f, 9 / 16);
  assert.equal(out.length, FULL_FEATURE_SIZE);
  assert.ok(out.slice(63, 126).some(v => v !== 0), '오른손 자리에 값이 있어야 함');
  assert.ok(out.slice(0, 63).every(v => v === 0), '왼손이 없으면 0');
  assert.ok(out.slice(126).some(v => v !== 0), '상체 자리에 값이 있어야 함');
});

console.log(`\n모두 통과 (${passed}개)`);
