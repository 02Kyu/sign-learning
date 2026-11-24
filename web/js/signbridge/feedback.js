/**
 * feedback.js — 기준 동작과 무엇이 얼마나 다른지 문장으로 알려준다 (SignBridge feedback.ts 기반, 크게 수정)
 *
 * 원본: SignBridge web/src/recognition/feedback.ts
 *       https://github.com/mhmdtaha091/SignBridge — MIT License, Copyright (c) 2026 SignBridge contributors
 *
 * 원본에서 그대로 따른 것
 *   - 규칙 흐름: 전체 점수 구간 안내 → 손 높이 → 손가락 벌림 → 손가락 → 속도 → 지적이 없을 때의 칭찬
 *   - 점수 구간: 35 미만 "많이 다름", 55 미만 "거의 다 옴", 지적이 없으면 75 이상 "아주 좋음" / 55 이상 "좋음"
 *   - 메시지 형식 { message, kind }와 최대 개수 4개
 *
 * [한국어 학습판]에서 고친 것 (원본의 문제)
 *   1. 손 높이: 손목을 원점으로 정규화한 좌표에서 손목 높이를 비교해 값이 항상 0이었다
 *      → 어깨 기준 손목 위치로 비교하고, 좌우도 함께 본다.
 *   2. 오른손만 검사했다 → 양손을 검사한다.
 *   3. 동작 전체의 평균끼리 비교했다 → DTW 경로로 짝지은 순간끼리 비교한다.
 *   4. 속도를 프레임 수로 비교해 카메라 초당 프레임이 다르면 틀렸다 → 초 단위로 비교한다.
 *   5. 영어 문구 → 한국어. 메시지 타입은 React 컴포넌트에서 가져오지 않고 이 파일에서 정의한다.
 *
 * [한국어 학습판]에서 넓힌 것 (원본: 검지~새끼 끝 간격, 검지 끝 높이만 봄)
 *   마디별 굽힘(손가락 5 × 마디 3), 이웃 손가락 사이 벌림, 엄지와 다른 손가락 끝 닿음, 엄지 접힘,
 *   손바닥 방향, 손 사용 여부, 움직임 크기, 가장 다른 구간
 *
 * @typedef {{ message: string, kind: 'raise'|'tuck'|'speed'|'general'|'shape'|'palm'|'usage'|'size' }} FeedbackMessage
 *   kind: 원본의 raise(높이)·tuck(손가락 모으기/벌리기)·speed(속도)·general(전체)에
 *         shape(손가락 관절)·palm(손바닥 방향)·usage(손 사용)·size(움직임 크기)를 더했다.
 */

/* ── 좌표 배치 (대만 258개 좌표) ─────────────────────────── */
const HAND_OFFSETS = [132, 195];   // 손 블록 A, B
const L_SHOULDER = 11, R_SHOULDER = 12;
const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17, THUMB_TIP = 4;

/* 대만 코드는 화면을 좌우 반전해서 넣으므로 손 블록 A가 사용자의 오른손이다.
   처음 한 번 오른손만 들고 확인해서, 반대로 나오면 두 이름을 바꾼다. */
export const HAND_NAMES = ['오른손', '왼손'];

/* 손가락마다 관절 번호를 손목에서 끝까지. chain[1]~chain[3] 세 마디의 굽힘 각도를 잰다 (곧으면 0°).
   MediaPipe 손 관절: 0 손목, 1~4 엄지, 5~8 검지, 9~12 중지, 13~16 약지, 17~20 새끼 */
const FINGERS = [
  { name: '엄지', obj: '엄지를', chain: [0, 1, 2, 3, 4] },
  { name: '검지', obj: '검지를', chain: [0, 5, 6, 7, 8] },
  { name: '중지', obj: '중지를', chain: [0, 9, 10, 11, 12] },
  { name: '약지', obj: '약지를', chain: [0, 13, 14, 15, 16] },
  { name: '새끼손가락', obj: '새끼손가락을', chain: [0, 17, 18, 19, 20] },
];
const JOINT_NAMES = ['뿌리 마디', '가운데 마디', '끝 마디'];
/* 이웃 손가락 사이 벌림: 두 손가락 첫 마디 방향을 손바닥 면에 눕혀서 잰 각도 */
const SPREADS = [
  { obj: '검지와 중지를', a: [5, 6], b: [9, 10] },
  { obj: '중지와 약지를', a: [9, 10], b: [13, 14] },
  { obj: '약지와 새끼손가락을', a: [13, 14], b: [17, 18] },
];
/* 엄지 끝과 다른 손가락 끝이 닿는지 */
const TOUCHES = [
  { label: '엄지와 검지', tip: 8 }, { label: '엄지와 중지', tip: 12 },
  { label: '엄지와 약지', tip: 16 }, { label: '엄지와 새끼손가락', tip: 20 },
];

export const FEEDBACK_OPTIONS = Object.freeze({
  maxMessages: 4,         // 원본과 같음
  posThreshold: 0.2,      // 손 위치 차이 기준 (어깨너비 단위)
  palmThreshold: 50,      // 손바닥 방향 차이 기준 (도)
  bendThreshold: 30,      // 마디 굽힘 각도 차이 기준 (도)
  spreadThreshold: 12,    // 손가락 사이 벌림 차이 기준 (도)
  touchOn: 0.35,          // 손가락 끝 거리가 이 이하면 "닿음" (손바닥 길이 단위)
  thumbThreshold: 0.4,    // 엄지 접힘 차이 기준 (손바닥 길이 단위)
  sizeRange: [0.6, 1.7],  // 움직임 크기 비율이 이 범위를 벗어나면 알림
  speedRange: [0.55, 1.4],// 동작 시간 비율 (원본 기준: 0.55배보다 빠르거나 1.4배보다 느리면)
});

/* ── 손 모양 계산 ──────────────────────────────────────── */
const has = (f, from, to) => { for (let i = from; i < to; i += 1) if (f[i] !== 0) return true; return false; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = v => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const n = len3(v); return n > 1e-6 ? v.map(x => x / n) : null; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function angleDeg(a, b) {
  const ua = unit(a), ub = unit(b);
  if (!ua || !ub) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot3(ua, ub)))) * 180 / Math.PI;
}
const flatten = (v, n) => { const d = dot3(v, n); return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]; };

/**
 * 대만 258개 좌표 한 프레임 → 규칙에 쓰는 손 정보 { hands: [A손 | null, B손 | null] }. 몸이 안 잡혔으면 null.
 * ky: 세로 좌표에 곱할 값 (= 1 / 화면 가로세로비)
 */
export function handGeometry(f, ky) {
  if (!has(f, 0, 132)) return null;
  const sx0 = f[L_SHOULDER * 4], sy0 = f[L_SHOULDER * 4 + 1] * ky;
  const sx1 = f[R_SHOULDER * 4], sy1 = f[R_SHOULDER * 4 + 1] * ky;
  const sw = Math.hypot(sx0 - sx1, sy0 - sy1);
  if (sw < 0.05) return null;
  const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;

  const hands = HAND_OFFSETS.map(off => {
    if (!has(f, off, off + 63)) return null;
    const P = k => [f[off + k * 3], f[off + k * 3 + 1] * ky, f[off + k * 3 + 2]];
    const wrist = P(WRIST);
    const palmLen = len3(sub(P(MIDDLE_MCP), wrist));
    if (palmLen < 1e-4) return null;
    const normal = unit(cross(sub(P(INDEX_MCP), wrist), sub(P(PINKY_MCP), wrist)));   // 손바닥 방향
    const bend = [];
    for (const fg of FINGERS) {
      for (let k = 1; k <= 3; k += 1) {
        const c = fg.chain;
        bend.push(angleDeg(sub(P(c[k]), P(c[k - 1])), sub(P(c[k + 1]), P(c[k]))));
      }
    }
    const spread = SPREADS.map(sp => {
      const a = sub(P(sp.a[1]), P(sp.a[0])), b = sub(P(sp.b[1]), P(sp.b[0]));
      return normal ? angleDeg(flatten(a, normal), flatten(b, normal)) : angleDeg(a, b);
    });
    return {
      x: (wrist[0] - cx) / sw,                                    // 어깨 중심 기준, 어깨너비 단위
      y: (wrist[1] - cy) / sw,                                    // 아래로 갈수록 +
      bend,                                                       // 15개 (도)
      spread,                                                     // 3개 (도)
      touch: TOUCHES.map(t => len3(sub(P(THUMB_TIP), P(t.tip))) / palmLen),
      thumbOut: len3(sub(P(THUMB_TIP), P(PINKY_MCP))) / palmLen,  // 엄지가 바깥으로 나간 정도
      normal,
    };
  });
  return { hands };
}

const presence = (seq, h) => seq.filter(f => f && f.hands[h]).length / seq.length;
function pathLength(seq, h) {
  let s = 0, prev = null;
  for (const f of seq) {
    const p = f && f.hands[h];
    if (p && prev) s += Math.hypot(p.x - prev.x, p.y - prev.y);
    if (p) prev = p;
  }
  return s;
}

/**
 * 피드백 만들기.
 * @param {object} input
 *   learner / reference: { geometry: handGeometry()[] (같은 길이로 맞춘 프레임들), seconds: 동작 시간(초) }
 *   path:  SignBridge dtw()의 경로 [학습자 번호, 기준 번호][]
 *   costs: 경로 각 짝의 SignBridge 특징 거리 (가장 다른 구간 찾기에 씀)
 *   score: 0~100 (SignBridge 식)
 * @returns {{ messages: FeedbackMessage[], items: object[], phase: object }}
 */
export function generateFeedback({ learner, reference, path, costs, score }, options = {}) {
  const o = { ...FEEDBACK_OPTIONS, ...options };
  const att = learner.geometry, ref = reference.geometry;
  if (!att.length || !ref.length || !path.length) {
    return { messages: [{ message: '손이 잡히지 않았어요. 밝은 곳에서 다시 해보세요.', kind: 'general' }], items: [], phase: null };
  }

  const items = [];
  const add = (kind, part, aspect, value, unit, severity, message) =>
    items.push({ kind, part, aspect, value: Math.round(value * 100) / 100, unit, severity, message });

  for (let h = 0; h < 2; h += 1) {
    const name = HAND_NAMES[h];
    const pa = presence(att, h), pr = presence(ref, h);

    // 손 사용
    if (pr >= 0.5 && pa < 0.2) { add('usage', name, '사용', pa - pr, '비율', 3, `${name}도 함께 사용하는 수어예요.`); continue; }
    if (pr < 0.2 && pa >= 0.5) { add('usage', name, '사용', pa - pr, '비율', 2, `이 수어는 ${name}을 쓰지 않아요.`); continue; }

    // DTW로 짝지은 순간끼리 차이 모으기 (고친 점 3)
    let n = 0, dx = 0, dy = 0, ang = 0, angN = 0, thumb = 0;
    const bend = new Array(15).fill(0), spread = new Array(3).fill(0);
    const touchRef = new Array(4).fill(0), touchAtt = new Array(4).fill(0);
    for (const [i, j] of path) {
      const A = att[i] && att[i].hands[h], B = ref[j] && ref[j].hands[h];
      if (!A || !B) continue;
      n += 1; dx += A.x - B.x; dy += A.y - B.y; thumb += A.thumbOut - B.thumbOut;
      A.bend.forEach((v, k) => { bend[k] += v - B.bend[k]; });
      A.spread.forEach((v, k) => { spread[k] += v - B.spread[k]; });
      A.touch.forEach((v, k) => {
        if (v <= o.touchOn) touchAtt[k] += 1;
        if (B.touch[k] <= o.touchOn) touchRef[k] += 1;
      });
      if (A.normal && B.normal) {
        ang += Math.acos(Math.min(1, Math.max(-1, dot3(A.normal, B.normal)))) * 180 / Math.PI; angN += 1;
      }
    }
    if (n >= 3) {
      dx /= n; dy /= n;
      const pct = v => Math.round(Math.abs(v) * 100);
      // 손 높이·좌우 (고친 점 1, 2: 어깨 기준 손목, 양손)
      if (Math.abs(dy) >= o.posThreshold) {
        add('raise', name, '높이', -dy, '어깨너비', Math.abs(dy) / o.posThreshold,
            `${name}을 조금 더 ${dy > 0 ? '높이' : '낮게'} (어깨너비의 ${pct(dy)}%)`);
      }
      if (Math.abs(dx) >= o.posThreshold) {
        // 반전된 화면 기준이라 x가 크면 사용자가 보기에 오른쪽
        add('raise', name, '좌우', dx, '어깨너비', Math.abs(dx) / o.posThreshold,
            `${name}을 조금 더 ${dx > 0 ? '왼쪽' : '오른쪽'}으로 (어깨너비의 ${pct(dx)}%)`);
      }
      // 엄지 접힘 (엄지 마디 메시지보다 알기 쉬워서, 이게 나오면 엄지 마디 메시지는 생략)
      const dt = thumb / n;
      const thumbMoved = Math.abs(dt) >= o.thumbThreshold;
      if (thumbMoved) {
        add('shape', name, '엄지 위치', dt, '손바닥 길이', Math.abs(dt) / o.thumbThreshold + 0.5,
            `${name} 엄지를 ${dt > 0 ? '손바닥 쪽으로 더 접으세요' : '바깥으로 더 펴세요'}`);
      }
      // 마디 굽힘 (원본의 "검지 끝 높이"를 모든 손가락·마디로 넓힘)
      FINGERS.forEach((fg, f) => {
        if (f === 0 && thumbMoved) return;
        const d = [0, 1, 2].map(k => bend[f * 3 + k] / n);          // + = 학습자가 더 굽힘
        const big = [0, 1, 2].filter(k => Math.abs(d[k]) >= o.bendThreshold);
        const word = v => (v > 0 ? '펴세요' : '굽히세요');
        if (big.length === 3 && d.every(v => Math.sign(v) === Math.sign(d[0]))) {
          const avg = (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2])) / 3;
          add('shape', name, `${fg.name} 전체`, d[0] > 0 ? avg : -avg, '도', avg / o.bendThreshold + 0.5,
              `${name} ${fg.obj} 더 ${word(d[0])} (마디마다 약 ${Math.round(avg)}°)`);
          return;
        }
        for (const k of big) {
          add('shape', name, `${fg.name} ${JOINT_NAMES[k]}`, d[k], '도', Math.abs(d[k]) / o.bendThreshold,
              `${name} ${fg.name} ${JOINT_NAMES[k]}를 더 ${word(d[k])} (약 ${Math.round(Math.abs(d[k]))}°)`);
        }
      });
      // 손가락 사이 벌림 (원본의 "검지~새끼 끝 간격"을 이웃 손가락 3쌍 각도로 넓힘)
      SPREADS.forEach((sp, k) => {
        const d = spread[k] / n;                                      // + = 학습자가 더 벌림
        if (Math.abs(d) >= o.spreadThreshold) {
          add('tuck', name, `${sp.obj.slice(0, -1)} 사이`, d, '도', Math.abs(d) / o.spreadThreshold,
              `${name} ${sp.obj} 더 ${d > 0 ? '붙이세요' : '벌리세요'} (약 ${Math.round(Math.abs(d))}°)`);
        }
      });
      // 손가락 끝 닿음
      TOUCHES.forEach((t, k) => {
        const r = touchRef[k] / n, a = touchAtt[k] / n;
        if (r >= 0.5 && a <= 0.2) add('shape', name, `${t.label} 끝`, a - r, '닿은 비율', 2.5, `${name} ${t.label} 끝을 붙이세요`);
        if (r <= 0.2 && a >= 0.5) add('shape', name, `${t.label} 끝`, a - r, '닿은 비율', 2.5, `${name} ${t.label} 끝을 떼세요`);
      });
      // 손바닥 방향
      if (angN >= 3 && ang / angN >= o.palmThreshold) {
        add('palm', name, '손바닥 방향', ang / angN, '도', (ang / angN) / o.palmThreshold,
            `${name} 손바닥 방향이 달라요 (약 ${Math.round(ang / angN)}°)`);
      }
    }

    // 움직임 크기
    const lr = pathLength(ref, h), la = pathLength(att, h);
    if (lr >= 0.3 && pa >= 0.5) {
      const ratio = la / lr;
      if (ratio < o.sizeRange[0] || ratio > o.sizeRange[1]) {
        add('size', name, '움직임 크기', ratio, '기준 대비', ratio < 1 ? o.sizeRange[0] / ratio : ratio / o.sizeRange[1],
            `${name} 움직임을 더 ${ratio < 1 ? '크게' : '작게'} (기준의 ${Math.round(ratio * 100)}%)`);
      }
    }
  }

  // 속도 (고친 점 4: 초 단위)
  if (learner.seconds > 0 && reference.seconds > 0) {
    const ratio = learner.seconds / reference.seconds;
    if (ratio < o.speedRange[0] || ratio > o.speedRange[1]) {
      add('speed', '전체', '속도', ratio, '기준 대비', ratio < 1 ? o.speedRange[0] / ratio : ratio / o.speedRange[1],
          `조금 더 ${ratio < 1 ? '천천히' : '빠르게'} 해보세요 (기준 ${reference.seconds}초, 지금 ${learner.seconds}초)`);
    }
  }

  // 가장 다른 구간 (기준 동작을 처음·중간·끝으로 나눠 평균 거리)
  const thirds = [[], [], []];
  path.forEach(([, j], k) => thirds[Math.min(2, Math.floor((3 * j) / ref.length))].push(costs[k]));
  const phaseCosts = thirds.map(c => (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0));
  const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;
  const worstIdx = phaseCosts.indexOf(Math.max(...phaseCosts));
  const phase = { worst: ['처음', '중간', '끝'][worstIdx], costs: phaseCosts.map(c => Math.round(c * 100) / 100) };

  // 메시지 정리: 전체 안내(원본 1번) → 차이가 큰 순서 → 지적이 없으면 칭찬(원본 6번), 최대 4개
  items.sort((a, b) => b.severity - a.severity);
  const messages = [];
  if (score < 35) messages.push({ message: '기준 동작과 많이 달라요. 예시를 천천히 다시 보고 손 모양부터 맞춰보세요.', kind: 'general' });
  else if (score < 55) messages.push({ message: '거의 다 왔어요! 손가락 위치를 예시에 더 가깝게 맞춰보세요.', kind: 'general' });
  for (const it of items) messages.push({ message: it.message, kind: it.kind });
  if (items.length && phaseCosts[worstIdx] > 1.5 * meanCost) {
    messages.push({ message: `동작 ${phase.worst} 부분이 가장 달라요.`, kind: 'general' });
  }
  if (!items.length) {
    if (score >= 75) messages.push({ message: '아주 좋아요! 손 모양과 움직임이 기준 동작과 잘 맞아요.', kind: 'general' });
    else if (score >= 55) messages.push({ message: '좋아요! 조금만 더 연습하면 기준 동작에 더 가까워져요.', kind: 'general' });
    // 55점 미만은 위의 전체 안내가 이미 들어가 있다
  }
  return { messages: messages.slice(0, o.maxMessages), items, phase };
}
