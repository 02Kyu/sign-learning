// 테스트용 가상 손: 손가락별 마디 굽힘·벌림 각도로 MediaPipe 손 관절 21개 좌표를 만든다.
// 가상 손 만들기: 손가락별 굽힘(마디 3개)과 벌림 각도로 21개 관절 좌표를 만든다.
const ASPECT = 16 / 9, RAD = Math.PI / 180;
const N = [0, 0, -1];                          // 손바닥이 카메라를 향함 → 굽히면 카메라 쪽(-z)
const BASE = { thumb: [0.03, -0.03], index: [0.025, -0.09], middle: [0.005, -0.095], ring: [-0.015, -0.09], pinky: [-0.033, -0.08] };
const LEN = { thumb: [0.035, 0.03, 0.025], index: [0.045, 0.027, 0.022], middle: [0.048, 0.03, 0.023], ring: [0.045, 0.028, 0.022], pinky: [0.035, 0.02, 0.018] };
const IDX = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
export const DEFAULT_SHAPE = {
  thumb: { spread: 45, bend: [10, 10, 10] }, index: { spread: 8, bend: [0, 0, 0] }, middle: { spread: 0, bend: [0, 0, 0] },
  ring: { spread: -6, bend: [0, 0, 0] }, pinky: { spread: -14, bend: [0, 0, 0] },
};
export function handPoints(wx, wy, shape) {
  const pts = Array.from({ length: 21 }, () => [0, 0, 0]);
  pts[0] = [wx, wy, 0];
  for (const f of Object.keys(IDX)) {
    const { spread, bend } = shape[f];
    const d0 = [Math.sin(spread * RAD), -Math.cos(spread * RAD), 0];
    const ids = IDX[f];
    pts[ids[0]] = [wx + BASE[f][0], wy + BASE[f][1], 0];
    let th = 0, p = pts[ids[0]];
    for (let k = 0; k < 3; k += 1) {
      th += bend[k] * RAD;
      const d = [d0[0] * Math.cos(th) + N[0] * Math.sin(th), d0[1] * Math.cos(th) + N[1] * Math.sin(th), N[2] * Math.sin(th)];
      p = [p[0] + LEN[f][k] * d[0], p[1] + LEN[f][k] * d[1], p[2] + LEN[f][k] * d[2]];
      pts[ids[k + 1]] = p;
    }
  }
  if (shape.touch) pts[4] = [...pts[shape.touch]];     // 엄지 끝을 다른 손가락 끝에 붙이기
  return pts;
}
/** 한 프레임(258개). 손 블록 A(사용자 오른손)는 (wx, wy)에, second가 있으면 블록 B(왼손)도 넣는다.
    실제 MediaPipe처럼 몸 좌표의 손목(15: A쪽, 16: B쪽)과 팔꿈치도 채운다. */
export function frame(wx, wy, shape, second = null) {
  const f = new Float32Array(258);
  const P = (k, x, y) => { f[k * 4] = x; f[k * 4 + 1] = y * ASPECT; f[k * 4 + 3] = 1; };
  P(0, 0.5, 0.2); P(7, 0.53, 0.2); P(8, 0.47, 0.2); P(11, 0.6, 0.28); P(12, 0.4, 0.28);
  P(23, 0.57, 0.5); P(24, 0.43, 0.5);
  const put = (off, x, y, sh) => handPoints(x, y, sh).forEach((p, k) => { f[off + k * 3] = p[0]; f[off + k * 3 + 1] = p[1] * ASPECT; f[off + k * 3 + 2] = p[2]; });
  put(132, wx, wy, shape); P(15, wx, wy); P(13, (wx + 0.6) / 2, (wy + 0.28) / 2 + 0.05);
  if (second) { put(195, second[0], second[1], second[2] || shape); P(16, second[0], second[1]); P(14, (second[0] + 0.4) / 2, (second[1] + 0.28) / 2 + 0.05); }
  return f;
}
export const shapeWith = (changes) => {
  const s = JSON.parse(JSON.stringify(DEFAULT_SHAPE));
  for (const [f, v] of Object.entries(changes)) { if (f === 'touch') s.touch = v; else Object.assign(s[f], v); }
  return s;
};
