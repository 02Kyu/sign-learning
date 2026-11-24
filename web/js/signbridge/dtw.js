/**
 * dtw.js — SignBridge의 DTW (거의 그대로 이식)
 *
 * 원본: SignBridge web/src/recognition/dtw.ts
 *       https://github.com/mhmdtaha091/SignBridge — MIT License, Copyright (c) 2026 SignBridge contributors
 * 바꾼 것: TypeScript 타입 표기를 지우고 주석을 한국어로 옮긴 것뿐, 계산은 원본과 같다.
 *
 * 역할: 속도가 다른 두 동작(프레임 배열)의 시간을 맞추고, 거리와 짝지은 프레임 경로를 돌려준다.
 * 60프레임끼리면 3,600칸 계산이라 브라우저에서 충분히 빠르다.
 */

/** 두 프레임(같은 길이의 숫자 배열) 사이의 유클리드 거리 */
function frameDist(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * 두 다변량 시계열 a, b의 DTW.
 * @param {number[][]} a 프레임 배열 (각 프레임은 number[])
 * @param {number[][]} b
 * @returns {{distance: number, normalizedDistance: number, path: Array<[number, number]>}}
 *   distance: 누적 거리 (작을수록 비슷함)
 *   normalizedDistance: 0~1로 맞춘 거리 (원본 설명: 같은 수어를 다른 사람이 하면 약 0.15)
 *   path: [a의 프레임 번호, b의 프레임 번호] 짝 목록
 */
export function dtw(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return { distance: Infinity, normalizedDistance: 1, path: [] };
  }

  // 누적 비용 행렬
  const d = new Array(n);
  for (let i = 0; i < n; i++) d[i] = new Float64Array(m);

  d[0][0] = frameDist(a[0], b[0]);

  // 첫 행
  for (let j = 1; j < m; j++) {
    d[0][j] = frameDist(a[0], b[j]) + d[0][j - 1];
  }
  // 첫 열
  for (let i = 1; i < n; i++) {
    d[i][0] = frameDist(a[i], b[0]) + d[i - 1][0];
  }

  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      const cost = frameDist(a[i], b[j]);
      d[i][j] = cost + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }

  // 되짚어 경로 만들기
  const path = [];
  let i = n - 1;
  let j = m - 1;
  while (i > 0 || j > 0) {
    path.push([i, j]);
    if (i === 0) { j--; }
    else if (j === 0) { i--; }
    else {
      const up = d[i - 1][j];
      const left = d[i][j - 1];
      const diag = d[i - 1][j - 1];
      if (diag <= up && diag <= left) { i--; j--; }
      else if (up <= left) { i--; }
      else { j--; }
    }
  }
  path.push([0, 0]);
  path.reverse();

  const distance = d[n - 1][m - 1];
  const normalizedDistance = Math.min(1, distance / Math.sqrt(n * m));

  return { distance, normalizedDistance, path };
}
