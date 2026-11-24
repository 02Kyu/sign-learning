#!/usr/bin/env python3
"""기준 동작 만들기 — 단어마다 대표 녹화 하나를 골라 web/references/{단어}.json으로 저장

대만 저장소의 tools/抽關鍵點.py가 만든 좌표 파일(data/關鍵點/{단어}/*.npy, 각 (프레임 수, 258))을 읽는다.
대표 녹화는 SignBridge의 방식으로 고른다: 같은 단어의 녹화끼리 DTW 거리를 재서, 다른 녹화들과의 평균 거리가
가장 작은 것(메도이드). 거리를 잴 때도 웹(learning.js)과 같은 SignBridge 159개 특징을 쓴다.

이식한 부분: SignBridge ml/export_reference_trajectories.py의 frame_dist, dtw, find_medoid와
web/src/vision/normalize.ts의 정규화 (https://github.com/mhmdtaha091/SignBridge,
MIT License, Copyright (c) 2026 SignBridge contributors). 대만 좌표 변환과 명령 인자는 [한국어 학습판]에서 작성.

예)
    python tools/make_reference.py                                # 모든 단어
    python tools/make_reference.py --words 학교 병원 --signer T     # 선생님(T) 녹화만 사용
    python tools/make_reference.py --words 학교 --clip 학교_T_1120-101500_03
주의: --aspect는 원본 영상의 가로÷세로 (1280×720, 1920×1080이면 기본값 16/9 그대로).
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ROWS = 40
POSE_UPPER_INDICES = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24]
TAIWAN_RIGHT_HAND, TAIWAN_LEFT_HAND = 132, 195   # 화면을 좌우 반전해 넣으므로 블록 A가 사용자의 오른손


# ── 웹(learning.js)과 같은 전처리 ──────────────────────────────────────
def active_resample(seq, rows=ROWS):
    """preprocess.js의 resampleActive와 같은 방식: 손이 보이는 구간만 잘라 rows개로 뽑는다."""
    has = np.any(seq[:, 132:] != 0, axis=1)
    if not has.any():
        return None
    first, last = np.argmax(has), len(has) - 1 - np.argmax(has[::-1])
    seg = seq[first:last + 1]
    idx = np.round(np.linspace(0, len(seg) - 1, rows)).astype(int)
    return seg[idx]


def normalize_hand(lm, mirror):
    """SignBridge normalizeHand: 손목 원점, 손바닥 길이(0→9)로 나눔, 왼손은 x 뒤집기"""
    s = np.linalg.norm(lm[9] - lm[0])
    s = s if s > 1e-6 else 1.0
    out = (lm - lm[0]) / s
    out[:, 0] *= mirror
    return out.ravel()


def normalize_pose_upper(pose):
    """SignBridge normalizePoseUpper: 어깨 가운데 원점, 어깨너비로 나눔, 상체 관절 11개만"""
    c = (pose[11] + pose[12]) / 2
    s = np.linalg.norm(pose[12] - pose[11])
    s = s if s > 1e-6 else 1.0
    return ((pose[POSE_UPPER_INDICES] - c) / s).ravel()


def signbridge_features(f, ky):
    """대만 258개 좌표 한 프레임 → SignBridge 159개 특징 [왼손 63 | 오른손 63 | 상체 33] (normalize.js와 같음)"""
    out = np.zeros(159, dtype=np.float64)
    for off, start, mirror in ((TAIWAN_LEFT_HAND, 0, -1), (TAIWAN_RIGHT_HAND, 63, 1)):
        block = f[off:off + 63]
        if block.any():
            lm = block.reshape(21, 3).astype(np.float64).copy()
            lm[:, 1] *= ky
            out[start:start + 63] = normalize_hand(lm, mirror)
    if f[:132].any():
        pose = f[:132].reshape(33, 4)[:, :3].astype(np.float64).copy()
        pose[:, 1] *= ky
        out[126:] = normalize_pose_upper(pose)
    return out


# ── SignBridge에서 이식: DTW와 메도이드 ──────────────────────────────────
def dtw(a, b):
    """SignBridge dtw (거리 행렬은 numpy로 한 번에 계산하고, 누적은 원본과 같은 점화식)"""
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return {"distance": float("inf"), "normalizedDistance": 1.0}
    cost = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2)   # = frame_dist(a[i], b[j])
    d = np.zeros((n, m), dtype=np.float64)
    d[0, 0] = cost[0, 0]
    for j in range(1, m):
        d[0, j] = cost[0, j] + d[0, j - 1]
    for i in range(1, n):
        d[i, 0] = cost[i, 0] + d[i - 1, 0]
    for i in range(1, n):
        for j in range(1, m):
            d[i, j] = cost[i, j] + min(d[i - 1, j], d[i, j - 1], d[i - 1, j - 1])
    distance = float(d[n - 1, m - 1])
    return {"distance": distance, "normalizedDistance": min(1.0, distance / math.sqrt(n * m))}


def find_medoid(sequences):
    """SignBridge find_medoid: 다른 시퀀스들과의 평균 DTW 정규화 거리가 가장 작은 것의 번호"""
    if not sequences:
        return None
    if len(sequences) == 1:
        return 0
    best_idx, best_avg = -1, float("inf")
    for i in range(len(sequences)):
        total = sum(dtw(sequences[i], sequences[j])["normalizedDistance"] for j in range(len(sequences)) if j != i)
        avg = total / (len(sequences) - 1)
        if avg < best_avg:
            best_avg, best_idx = avg, i
    return best_idx


# ── 실행 ────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="단어별 기준 동작 JSON 만들기")
    ap.add_argument("--keypoints", type=Path, default=ROOT / "data/關鍵點", help="抽關鍵點.py 출력 폴더")
    ap.add_argument("--out", type=Path, default=ROOT / "web/references")
    ap.add_argument("--words", nargs="*", help="만들 단어 (기본: 전부)")
    ap.add_argument("--signer", help="이 시연자 코드의 녹화만 사용 (파일명 {단어}_{시연자}_{배치}_{번호})")
    ap.add_argument("--clip", help="이 파일(확장자 제외)을 기준으로 사용")
    ap.add_argument("--fps", type=float, default=30.0, help="원본 영상의 초당 프레임 수")
    ap.add_argument("--aspect", type=float, default=16 / 9, help="원본 영상의 가로÷세로")
    ap.add_argument("--max-candidates", type=int, default=30, help="대표를 고를 때 비교할 최대 녹화 수")
    a = ap.parse_args()

    words = a.words or sorted(d.name for d in a.keypoints.iterdir() if d.is_dir())
    a.out.mkdir(parents=True, exist_ok=True)
    ky = 1.0 / a.aspect
    for word in words:
        files = sorted((a.keypoints / word).glob("*.npy"))
        if a.signer:
            files = [f for f in files if f.stem.split("_")[1:2] == [a.signer]]
        if a.clip:
            files = [f for f in files if f.stem == a.clip]
        files = files[:a.max_candidates]
        clips = [(f, np.load(f).astype(np.float32)) for f in files]
        if not clips:
            print(f"[건너뜀] {word}: 좌표 파일이 없습니다")
            continue

        usable, feats = [], []
        for k, (_, seq) in enumerate(clips):
            rows = active_resample(seq)
            if rows is not None:
                usable.append(k)
                feats.append(np.stack([signbridge_features(r, ky) for r in rows]))
        if not usable:
            print(f"[건너뜀] {word}: 손이 잡힌 녹화가 없습니다")
            continue

        k = usable[0] if a.clip else usable[find_medoid(feats)]
        path, seq = clips[k]
        data = {"word": word, "fps": a.fps, "aspect": round(a.aspect, 4), "source": path.stem,
                "frames": np.round(seq, 4).tolist()}
        (a.out / f"{word}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                            encoding="utf-8")
        print(f"[완료] {word}: {path.name} (후보 {len(usable)}개 중 SignBridge 메도이드, {len(seq)}프레임)")


if __name__ == "__main__":
    main()
