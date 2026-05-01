# 코드·작업 템플릿 (복붙용)

매 세션마다 긴 설명을 생성하지 않도록, 아래 블록을 그대로 쓰거나 최소만 채운다.

## 완료 보고(핸드오프)

```
## 변경 요약
- 

## 검증
- [ ] pnpm -r typecheck
- [ ] pnpm test:run
- [ ] pnpm build

## 미실행 항목 / 이유
- 
```

## DB 변경 시 자기 점검

```
- [ ] packages/db/schema + index export
- [ ] shared 타입/validator/API 상수
- [ ] server 라우트/서비스
- [ ] ui 클라이언트/페이지
- [ ] pnpm db:generate 후 마이그레이션 검토
```

## API 엔드포인트 추가 시

```
- [ ] company 접근 검사
- [ ] board vs agent 권한
- [ ] 뮤테이션 시 activity log
- [ ] HTTP 오류 코드 일관
```

## UI 변경 시

```
- [ ] 라우트/내비와 API 노출 일치
- [ ] company 스코프 UI
- [ ] 에러 UI 노출(무음 실패 금지)
```

## 짧은 커밋 메시지 스타일

- 한 줄, 명령형, 필요 시 `scope:` 접두어 (기존 히스토리와 맞출 것)
