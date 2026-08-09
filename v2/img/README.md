# 사례 사진

사례 카드에 들어가는 현장 사진을 여기에 둔다.

- 파일명 규칙: `<회사키>-<번호>.jpg` (예: `b-parts-1.jpg`)
- 권장 크기: 가로 800px 내외, 200KB 이하 (모바일 로딩용)
- 연결 위치: `v2/index.html` 의 `CASES[].after.photos[].src`
  ```js
  photos:[{src:"img/b-parts-1.jpg", cap:"AGV 운영 Layout"}, ...]
  ```
- `src`가 빈 문자열이면 카드에 「사진 준비 중」 자리표시가 나온다.
  실제 현장 사진이 아닌 이미지를 대신 채우지 않는다.
