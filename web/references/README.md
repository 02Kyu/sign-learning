# 기준 동작 파일

단어마다 `{단어}.json` 하나. `learning.js`가 연습 단어를 시작할 때 이 폴더에서 불러온다.
파일이 없는 단어는 정답 판정만 하고, 기준 동작 비교는 건너뛴다.

만드는 법 (저장소 맨 위 폴더에서):

    python tools/抽關鍵點.py                         # data/片段/ 영상 → data/關鍵點/ 좌표
    python tools/make_reference.py                   # 단어마다 대표 녹화 하나를 골라 여기에 저장 (SignBridge 메도이드 방식)
    python tools/make_reference.py --signer T        # 선생님(T) 녹화만 쓰기

형식: `{"word", "fps", "aspect"(가로÷세로), "source", "frames": [[258개 값], ...]}`
