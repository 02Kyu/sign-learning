// learning.js 테스트 (브라우저 없이 Node로 실행):  node tests/learning.test.mjs
// 실제 수어 데이터가 아니라 가상 손(hand.mjs)으로 판정·비교 규칙이 맞게 동작하는지만 확인한다.
// 비교는 SignBridge 엔진(signbridge/normalize.js → dtw.js → feedback.js)을 거친다.
import assert from 'node:assert/strict';
import { AccuracyJudge, LearningSession, compareToReference, loadReference } from '../web/js/learning.js';
import { setFrameAspect } from '../web/js/preprocess.js';
import { ContinuousRecognition } from '../web/js/continuous-core.js';
import { frame, shapeWith } from './hand.mjs';

setFrameAspect(1280, 720);
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

console.log('정답 판정 (AccuracyJudge)');
const labels = { 0: '학교', 1: '병원', 2: '가다' };
const ok = { reason: 'stabilizing', confirmed: null };
test('다른 단어로 보이면 오답 안내', () => {
  const j = new AccuracyJudge(); j.setLabels(labels); j.start('학교', 0);
  const v = j.update([0.1, 0.85, 0.05], ok, 100);
  assert.equal(v.verdict, 'wrong'); assert.match(v.message, /병원/);
});
test('목표 단어 0.9 이상 3번 연속이면 통과', () => {
  const j = new AccuracyJudge(); j.setLabels(labels); j.start('학교', 0);
  let v; for (const p of [0.92, 0.95, 0.97]) v = j.update([p, 1 - p, 0], ok, 200);
  assert.equal(v.verdict, 'pass'); assert.equal(v.score, 97);
});
test('시간이 지나면 시간 초과', () => {
  const j = new AccuracyJudge({ timeoutMs: 1000 }); j.setLabels(labels); j.start('병원', 0);
  assert.equal(j.tick(2000).verdict, 'timeout');
});

console.log('대만 continuous-core (단어 수 25 제한 제거 확인)');
test('단어 3개짜리 모델 점수도 받아들인다', () => {
  const c = new ContinuousRecognition();
  const d = c.observe([0.1, 0.8, 0.1], 0.9, 0);
  assert.notEqual(d.reason, 'invalid_scores');
});

console.log('기준 동작 비교 (SignBridge 엔진 + 관절 규칙)');
const CURL = [70, 90, 40], THUMB_IN = { spread: -25, bend: [30, 40, 30] };
const V = shapeWith({ index: { spread: 12 }, middle: { spread: -10 }, ring: { bend: CURL }, pinky: { bend: CURL }, thumb: THUMB_IN });
const seq = (shape, n = 30, dy = 0, ms = 33.3) => {
  const frames = [], times = [];
  for (let k = 0; k < n; k += 1) { frames.push(frame(0.55, 0.42 + dy - 0.06 * k / (n - 1), shape)); times.push(k * ms); }
  return { frames, times };
};
const refOf = (shape, word) => loadReference({ word, fps: 30, aspect: 16 / 9, frames: seq(shape).frames.map(f => Array.from(f)) });
const refV = refOf(V, 'V');
test('같은 동작은 100점, SignBridge 칭찬 메시지', () => {
  const r = compareToReference(refV, seq(V));
  assert.equal(r.score, 100); assert.equal(r.normalizedDistance, 0);
  assert.deepEqual(r.messages, ['아주 좋아요! 손 모양과 움직임이 기준 동작과 잘 맞아요.']);
});
test('U자(붙임) vs V자(벌림) → 손가락 사이 벌림 지적', () => {
  const U = shapeWith({ index: { spread: 2 }, middle: { spread: 0 }, ring: { bend: CURL }, pinky: { bend: CURL }, thumb: THUMB_IN });
  const r = compareToReference(refV, seq(U));
  assert.ok(r.messages.some(m => /검지와 중지를 더 벌리세요/.test(m))); assert.ok(r.score < 100);
});
test('검지 갈고리 → 가운데·끝 마디를 펴라고 마디별로 지적', () => {
  const hook = shapeWith({ index: { spread: 12, bend: [0, 75, 60] }, middle: { spread: -10 }, ring: { bend: CURL }, pinky: { bend: CURL }, thumb: THUMB_IN });
  const r = compareToReference(refV, seq(hook));
  assert.ok(r.messages.some(m => /검지 가운데 마디를 더 펴세요/.test(m)));
  assert.ok(r.messages.some(m => /검지 끝 마디를 더 펴세요/.test(m)));
});
test('약지를 다 폄 → 손가락 전체를 굽히라고 지적', () => {
  const ring = shapeWith({ index: { spread: 12 }, middle: { spread: -10 }, ring: { bend: [0, 0, 0] }, pinky: { bend: CURL }, thumb: THUMB_IN });
  assert.ok(compareToReference(refV, seq(ring)).messages.some(m => /약지를 더 굽히세요/.test(m)));
});
test('엄지를 바깥으로 폄 → 엄지를 접으라고 지적 (엄지 마디 메시지는 생략)', () => {
  const out = shapeWith({ index: { spread: 12 }, middle: { spread: -10 }, ring: { bend: CURL }, pinky: { bend: CURL }, thumb: { spread: 45, bend: [5, 5, 5] } });
  const r = compareToReference(refV, seq(out));
  assert.ok(r.messages.some(m => /엄지를 손바닥 쪽으로 더 접으세요/.test(m)));
  assert.ok(!r.messages.some(m => /엄지 .*마디/.test(m)));
});
test('동그라미(엄지-검지 끝 닿음) 기준에 끝을 뗀 손 → 붙이라고 지적', () => {
  const O = shapeWith({ index: { bend: [30, 55, 35] }, middle: { bend: [20, 20, 10] }, touch: 8, thumb: { spread: 10, bend: [20, 20, 20] } });
  const open = shapeWith({ index: { bend: [30, 55, 35] }, middle: { bend: [20, 20, 10] }, thumb: { spread: 45, bend: [10, 10, 10] } });
  assert.ok(compareToReference(refOf(O, 'O'), seq(open)).messages.some(m => /엄지와 검지 끝을 붙이세요/.test(m)));
});
test('손이 낮고 빠르면 높이·속도 지적', () => {
  const r = compareToReference(refV, seq(V, 15, 0.06));
  assert.ok(r.messages.some(m => /더 높이/.test(m))); assert.ok(r.messages.some(m => /천천히/.test(m)));
});

test('손가락이 하나만 달라도 점수가 내려가고, scoreScale을 올리면 점수 폭이 넓어진다', () => {
  const hook = shapeWith({ index: { spread: 12, bend: [0, 75, 60] }, middle: { spread: -10 }, ring: { bend: CURL }, pinky: { bend: CURL }, thumb: THUMB_IN });
  const a = compareToReference(refV, seq(hook)), b = compareToReference(refV, seq(hook), { scoreScale: 2.5 });
  assert.ok(a.score < 50); assert.ok(b.score > a.score);
});
test('[SignBridge 고친 점 2] 왼손 차이도 잡는다 (원본은 오른손만 검사)', () => {
  const two = (leftShape) => {
    const frames = [], times = [];
    for (let k = 0; k < 30; k += 1) { frames.push(frame(0.6, 0.42 - 0.06 * k / 29, V, [0.4, 0.42 - 0.06 * k / 29, leftShape])); times.push(k * 33.3); }
    return { frames, times };
  };
  const ref2 = loadReference({ word: '양손', fps: 30, aspect: 16 / 9, frames: two(V).frames.map(f => Array.from(f)) });
  const leftRing = shapeWith({ index: { spread: 12 }, middle: { spread: -10 }, ring: { bend: [0, 0, 0] }, pinky: { bend: CURL }, thumb: THUMB_IN });
  assert.ok(compareToReference(ref2, two(leftRing)).messages.some(m => /왼손 약지를 더 굽히세요/.test(m)));
  // 한 손만 하면 손 사용 지적
  assert.ok(compareToReference(ref2, seq(V)).messages.some(m => /왼손도 함께 사용하는 수어예요/.test(m)));
});
test('[SignBridge 고친 점 4] 속도는 프레임 수가 아니라 초로 비교 (초당 프레임이 달라도 같은 시간이면 지적 없음)', () => {
  const r = compareToReference(refV, seq(V, 15, 0, 66.6));   // 15프레임이지만 1초 (15fps 카메라)
  assert.ok(!r.messages.some(m => /천천히|빠르게/.test(m)));
});

console.log('LearningSession (한글 단어, 기준 동작 불러오기)');
const refFrames = seq(V).frames.map(f => Array.from(f));
globalThis.fetch = async url => ({ ok: url.includes(encodeURIComponent('학교')), json: async () => ({ word: '학교', fps: 30, aspect: 16 / 9, frames: refFrames }) });
const s = new LearningSession({ continuous: { reset() {} } });
s.setLabels(labels);
const a = await s.start('학교', 0); assert.equal(a.hasReference, true);
const b = await s.start('병원', 0); assert.equal(b.hasReference, false);
passed += 1; console.log('  ✓ 학교는 기준 동작 불러옴, 병원은 판정만');

console.log(`\n모두 통과 (${passed}개)`);
