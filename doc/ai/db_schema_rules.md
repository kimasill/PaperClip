# DB·데이터 모델 작업 지침

데이터베이스 스키마, 마이그레이션, Drizzle 모델을 건드릴 때만 이 파일을 읽는다.

## 스코프·계약 동기화

- 모든 도메인 엔티티는 **회사(company) 스코프**를 지킨다. 라우트·서비스에서 경계를 검증한다.
- 스키마/API 동작을 바꾸면 영향받는 층을 함께 맞춘다:
  - `packages/db` 스키마·export
  - `packages/shared` 타입·상수·validator
  - `server` 라우트·서비스
  - `ui` API 클라이언트·페이지

## 스키마 변경 워크플로

1. `packages/db/src/schema/*.ts` 편집
2. 새 테이블·export는 `packages/db/src/schema/index.ts`에 반영
3. 마이그레이션 생성:

```sh
pnpm db:generate
```

4. 컴파일 검증:

```sh
pnpm -r typecheck
```

## Drizzle 참고

- `packages/db/drizzle.config.ts`는 컴파일된 `dist/schema/*.js`를 읽는다.
- `pnpm db:generate`는 `packages/db`를 먼저 컴파일한다.

## 연결 모드·운영

임베디드 PG, Docker, Supabase 등 **연결 문자열·호스팅**은 `doc/DATABASE.md`를 연다(이 파일에 중복 두지 않음).
