# 출처 고지

## 대만 수어 인식 (taiwan-sign-language-recognition)
- 저장소: https://github.com/Meganlin0000/taiwan-sign-language-recognition
- 라이선스: MIT, Copyright (c) 2026 林欣頤 — 전문은 이 저장소의 `LICENSE`
- 이 저장소의 바탕이다. 대만 원본 파일을 바꾼 곳에는 `[한국어 학습판]` 주석을 달았다.

## SignBridge
- 저장소: https://github.com/mhmdtaha091/SignBridge
- 라이선스: MIT, Copyright (c) 2026 SignBridge contributors — 전문은 아래
- 가져온 코드
  - `web/js/signbridge/dtw.js` ← `web/src/recognition/dtw.ts` (그대로 이식)
  - `web/js/signbridge/normalize.js` ← `web/src/vision/normalize.ts`, `web/src/vision/types.ts`의 상수 (이식 + 대만 좌표 어댑터 추가)
  - `web/js/signbridge/feedback.js` ← `web/src/recognition/feedback.ts` (크게 수정)
  - `tools/make_reference.py`의 `dtw`, `find_medoid`, 정규화 ← `ml/export_reference_trajectories.py`, `web/src/vision/normalize.ts`
  - `tests/signbridge.test.mjs`의 1~2부 ← `web/src/recognition/dtw.test.ts`, `web/src/vision/normalize.test.ts`

```
MIT License

Copyright (c) 2026 SignBridge contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MediaPipe Holistic (web/vendor/holistic)
- 라이선스: Apache-2.0, Google — 전문은 `web/vendor/holistic/LICENSE`

## TensorFlow.js (web/vendor/tfjs)
- 라이선스: Apache-2.0, Google — 전문은 `web/vendor/tfjs/LICENSE`

## ITDA 한국수어 연습

- 특징 규격은 [k3810/sign-language-learner](https://github.com/k3810/sign-language-learner/tree/99dbfcebc3f32cf3babf2513843182f27faeebc4)의 `truth_studio.py`를 참고했다. MIT 전문은 [LICENSE-model.txt](web/practice/LICENSE-model.txt)에 있다.
- 동작 예본은 [danielelvs/multilingual-islr-mediapipe](https://huggingface.co/datasets/danielelvs/multilingual-islr-mediapipe/tree/6f5fb06) MIT 릴리스의 한국수어 부분을 사용한다. 원본은 Yang 외의 [Korean Sign Language Dataset](https://github.com/Yangseung/KSL)이다. `web/practice/model.json`에는 손·상체의 방향 특징과 양손의 관절 굽힘을 30프레임으로 맞춘 결과만 들어 있다. 얼굴 좌표, 원본 영상, 시연자 식별자는 포함하지 않았다. 통합 데이터의 관련 연구는 Dos Santos 외, *Proper Body Landmark Subset Enables More Accurate and 5X Faster Recognition of Isolated Signs in LIBRAS*다. [논문](https://doi.org/10.48550/arXiv.2510.24887)
- 시범 영상은 [국립국어원 한국수어사전](https://sldict.korean.go.kr/front/main/main.do)의 원본 URL에서 재생한다. 단어별 사전 페이지를 화면에 표시하며 영상 파일을 저장소에 포함하지 않는다.

## 우리가 새로 작성한 파일
`web/js/learning.js`, `web/js/learning-ui.js`, `web/learning.css`, `web/js/signbridge/normalize.js`의 2부(어댑터),
`web/js/signbridge/feedback.js`의 수정·추가 부분, `tools/make_reference.py`의 대만 좌표 처리와 명령 인자,
`tests/learning.test.mjs`, `tests/hand.mjs`, `tests/signbridge.test.mjs`의 3부, `web/references/README.md`,
`README_KO.md`, `CLAUDE.md`, 이 파일.
