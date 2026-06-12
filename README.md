# eCOA Demo — 백엔드 연동 버전

Express + SQLite(Node 내장) + Nodemailer(Gmail SMTP) 백엔드가 추가된 eCOA 데모입니다.
기존 프론트엔드 전용 버전은 `frontend-only-backup.html`로 백업되어 있습니다.

## 요구사항

- **Node.js 22 이상** (내장 SQLite 사용. `node -v`로 확인)

## 실행 방법

```
cd D:\test_eCOA
npm install
npm start
```

브라우저에서 http://localhost:3000 접속.

- 관리자 로그인: **admin / admin1234** (`.env`에서 변경)
- 데이터는 `ecoa.db` 파일에 저장됩니다. 서버를 재시작해도 유지되고, 초기화하려면 `ecoa.db` 파일을 삭제하면 됩니다.

## Gmail 실제 발송 설정

`.env` 파일을 열어 두 줄을 채우세요:

```
GMAIL_USER=더미계정@gmail.com
GMAIL_APP_PASS=앱비밀번호16자리
```

앱 비밀번호 발급: Google 계정 → 보안 → 2단계 인증 활성화 → 앱 비밀번호 생성.
비워두면 이메일은 **시뮬레이션 모드**로 동작합니다(발송 이력만 기록).
`.env` 수정 후 서버 재시작 필요.

## 구조

```
server.js          # Express 서버 + API + SQLite + 메일 발송
public/index.html  # 프론트엔드 (API 연동 버전)
ecoa.db            # SQLite DB (첫 실행 시 자동 생성, 시드 환자 3명)
.env               # 포트/관리자 계정/Gmail 설정
```

## API

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | /api/login | - | 관리자 로그인 (세션 쿠키) |
| POST | /api/logout | - | 로그아웃 |
| GET | /api/session | - | 세션 상태 |
| GET | /api/patients | 필요 | 환자 목록 + 응답 |
| POST | /api/patients | 필요 | 환자 등록 `{id, email}` |
| POST | /api/patients/:id/remind | 필요 | 알림 이메일 발송 |
| GET | /api/subjects/:id | 공개 | 환자 화면용 정보 |
| POST | /api/subjects/:id/response | 공개 | 응답 제출 (재제출 시 덮어씀) |

환자용 설문 딥링크: `http://localhost:3000/?subject=S-002`

## 데모용 주의사항

세션은 서버 메모리에 저장되어 재시작 시 로그아웃됩니다. HTTPS 미적용, 환자 응답 엔드포인트는 토큰 없이 식별코드만으로 접근 가능 — 실제 운영에는 별도 보안 설계가 필요합니다.
