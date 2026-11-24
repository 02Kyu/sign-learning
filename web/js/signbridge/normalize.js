/**
 * normalize.js — SignBridge의 좌표 정규화 (이식) + 대만 좌표 변환 어댑터 (추가)
 *
 * 원본: SignBridge web/src/vision/normalize.ts, web/src/vision/types.ts의 상수
 *       https://github.com/mhmdtaha091/SignBridge — MIT License, Copyright (c) 2026 SignBridge contributors
 * 1부(정규화)는 타입 표기만 지웠고 계산은 원본과 같다.
 * 2부(어댑터)는 [한국어 학습판]에서 새로 작성했다: 대만 코드의 258개 좌표를 SignBridge 입력 형식으로 바꾼다.
 */

/* ═══ 1부. SignBridge 원본 ═══════════════════════════════════════════════ */

/** 손 하나의 특징 수: 관절 21개 × (x, y, z) */
export const FEATURE_SIZE = 63;
/** 수어에 쓰는 상체 관절: 코(0), 귀(7, 8), 어깨(11, 12), 팔꿈치(13, 14), 손목(15, 16), 골반(23, 24) */
export const POSE_UPPER_INDICES = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24];
export const POSE_UPPER_SIZE = POSE_UPPER_INDICES.length * 3;   // 33
/** 양손 + 상체: 왼손(63) | 오른손(63) | 상체(33) = 159 */
export const FULL_FEATURE_SIZE = FEATURE_SIZE * 2 + POSE_UPPER_SIZE;

/**
 * 손 좌표를 위치·크기·좌우손에 상관없게 바꾼다.
 * - 손목(0번)을 원점으로 옮긴다.
 * - 손목 → 중지 뿌리(9번) 거리(손바닥 길이)로 나눈다. 카메라와의 거리에 영향받지 않는다.
 * - 왼손은 x를 뒤집어 두 손이 같은 공간을 쓰게 한다.
 * @param {{landmarks: {x:number,y:number,z:number}[], handedness: 'Left'|'Right'}} frame
 */
export function normalizeHand(frame) {
  const { landmarks, handedness } = frame;
  if (landmarks.length !== 21) {
    throw new Error(`expected 21 landmarks, got ${landmarks.length}`);
  }

  const wrist = landmarks[0];
  const mcp = landmarks[9];
  const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z);
  // 관절이 한 점에 몰린 프레임이면 0에 가까운 수로 나누지 않게
  const s = scale > 1e-6 ? scale : 1;
  const mirror = handedness === 'Left' ? -1 : 1;

  const out = new Array(FEATURE_SIZE);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = ((landmarks[i].x - wrist.x) / s) * mirror;
    out[i * 3 + 1] = (landmarks[i].y - wrist.y) / s;
    out[i * 3 + 2] = (landmarks[i].z - wrist.z) / s;
  }
  return out;
}

/**
 * 상체 관절을 어깨 기준으로 정규화한다.
 * - 기준점: 양 어깨(11, 12번)의 가운데
 * - 크기: 어깨너비 (두 어깨가 겹치면 1)
 * POSE_UPPER_INDICES에 있는 관절만 내보낸다.
 */
export function normalizePoseUpper(landmarks) {
  if (landmarks.length < 25) {
    throw new Error(`expected ≥ 25 pose landmarks, got ${landmarks.length}`);
  }

  const ls = landmarks[11];
  const rs = landmarks[12];
  const centerX = (ls.x + rs.x) / 2;
  const centerY = (ls.y + rs.y) / 2;
  const centerZ = (ls.z + rs.z) / 2;
  const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y, rs.z - ls.z);
  const s = shoulderWidth > 1e-6 ? shoulderWidth : 1;

  const out = new Array(POSE_UPPER_SIZE);
  for (let j = 0; j < POSE_UPPER_INDICES.length; j++) {
    const p = landmarks[POSE_UPPER_INDICES[j]];
    out[j * 3] = (p.x - centerX) / s;
    out[j * 3 + 1] = (p.y - centerY) / s;
    out[j * 3 + 2] = (p.z - centerZ) / s;
  }
  return out;
}

/**
 * 한 프레임의 159개 특징: [왼손(63) | 오른손(63) | 상체(33)].
 * 손이나 몸이 안 잡혔으면 그 자리는 0으로 채워 길이를 항상 같게 한다.
 */
export function buildFullFeatures(leftHand, rightHand, poseLandmarks) {
  const out = new Array(FEATURE_SIZE * 2 + POSE_UPPER_SIZE).fill(0);

  if (leftHand) {
    const f = normalizeHand(leftHand);
    for (let i = 0; i < FEATURE_SIZE; i++) out[i] = f[i];
  }
  if (rightHand) {
    const f = normalizeHand(rightHand);
    for (let i = 0; i < FEATURE_SIZE; i++) out[FEATURE_SIZE + i] = f[i];
  }
  if (poseLandmarks) {
    const f = normalizePoseUpper(poseLandmarks);
    for (let i = 0; i < POSE_UPPER_SIZE; i++) {
      out[FEATURE_SIZE * 2 + i] = f[i];
    }
  }
  return out;
}

/** 두 특징 벡터 사이의 유클리드 거리 */
export function featureDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/* ═══ 2부. [한국어 학습판] 대만 좌표 → SignBridge 입력 어댑터 ═══════════════ */

/*
 * 대만 extractKeypoints()의 258개 좌표: 몸 33×(x,y,z,보임) | 손 블록 A 21×3 | 손 블록 B 21×3.
 * 대만 코드는 MediaPipe에 넣기 전에 화면을 좌우 반전하므로, 손 블록 A(132~194)가 사용자의 오른손이다.
 * 그래서 A → SignBridge의 오른손 자리, B(195~257) → 왼손 자리에 넣는다.
 * (사용자 동작과 기준 동작이 같은 변환을 거치므로, 혹시 반대여도 비교 결과는 맞다. 이름만 바뀐다.)
 */
export const TAIWAN_RIGHT_HAND = 132;
export const TAIWAN_LEFT_HAND = 195;

const has = (f, from, to) => { for (let i = from; i < to; i++) if (f[i] !== 0) return true; return false; };

/**
 * 대만 258개 좌표 한 프레임 → SignBridge 형식 { leftHand, rightHand, pose }.
 * @param {Float32Array|number[]} f 258개 좌표
 * @param {number} ky 세로 좌표에 곱할 값 (= 1 / 화면 가로세로비). 가로·세로 단위를 맞춰 각도·거리가 찌그러지지 않게 한다.
 */
export function fromTaiwanFrame(f, ky = 1) {
  const hand = (off, handedness) => {
    if (!has(f, off, off + 63)) return null;
    const landmarks = [];
    for (let k = 0; k < 21; k++) landmarks.push({ x: f[off + k * 3], y: f[off + k * 3 + 1] * ky, z: f[off + k * 3 + 2] });
    return { landmarks, handedness, score: 1 };
  };
  let pose = null;
  if (has(f, 0, 132)) {
    pose = [];
    for (let k = 0; k < 33; k++) pose.push({ x: f[k * 4], y: f[k * 4 + 1] * ky, z: f[k * 4 + 2] });
  }
  return { leftHand: hand(TAIWAN_LEFT_HAND, 'Left'), rightHand: hand(TAIWAN_RIGHT_HAND, 'Right'), pose };
}

/** 대만 258개 좌표 한 프레임 → SignBridge 159개 특징 */
export function taiwanToFeatures(f, ky = 1) {
  const { leftHand, rightHand, pose } = fromTaiwanFrame(f, ky);
  return buildFullFeatures(leftHand, rightHand, pose);
}
