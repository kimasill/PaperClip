# Paperclip 회사 컨벤션 (도구)

## Windows에서 `rg`(ripgrep) 사용

- 경로 인자 **하나**에 `**` 또는 `*` 를 넣지 마세요. Windows는 그 문자열을 실제 폴더 경로로 열려다 실패합니다(os error 123: 잘못된 경로 구문).
- **작업 루트(워크스페이스·레포 루트)만** 절대 경로로 넘기고, 파일 범위는 **`--glob`** 으로 지정하세요.
  - 허용: `rg "검색어" "C:\path\to\root" --glob "**/*vitest*.ts"`
  - 금지: `rg "검색어" "C:\path\to\root\**\vitest*.ts"` 처럼 글롭이 경로에 붙은 형태

Codex·CLI 도구가 위 금지 형태를 만들면 Windows에서 깨지므로, 검색·스캔 명령을 쓸 때는 항상 이 형식을 따르세요.
