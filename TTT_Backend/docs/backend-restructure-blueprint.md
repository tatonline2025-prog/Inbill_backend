# Backend Restructure Blueprint (TTT)

## 1) Mục tiêu nghiệp vụ

Xây backend theo đúng bài toán:
- Thành viên đăng ký, nạp tiền, chọn và mua mã 4 số (0000-9999).
- Mã gắn theo kỳ quay và loại giải.
- Trúng thưởng dựa trên 4 số cuối của kết quả Long An theo đúng loại giải tương ứng.
- Tự động chấm thưởng, trả thưởng, đối soát minh bạch.

Nguyên tắc cốt lõi:
- Cùng một mã 4 số có thể tồn tại ở nhiều kỳ quay khác nhau.
- Mỗi loại giải là một thị trường riêng (ĐB, G1, G2...).
- Không cho phép mua trùng mã trong cùng kỳ quay + cùng loại giải.

---

## 2) Kiến trúc module đề xuất

Tách theo domain rõ ràng:

1. Identity
- Đăng ký/đăng nhập.
- RBAC: user, operator, admin.

2. Wallet
- Số dư user.
- Sổ cái (ledger) immutable.

3. Draw Management
- Kỳ quay Long An.
- Trạng thái kỳ quay: scheduled/open/closed/result_ready/settled.

4. Ticket Pool
- Kho mã 4 số theo draw + prizeTier.
- Trạng thái mã: available/reserved/sold/settled_win/settled_lose.

5. Order & Checkout
- Reserve mã tạm giữ.
- Confirm mua mã (trừ tiền và chốt đơn).
- Idempotency chống retry tạo đơn trùng.

6. Result Ingestion
- Lấy kết quả Long An từ nguồn chính.
- Chuẩn hóa kết quả theo loại giải.

7. Settlement Engine
- So khớp 4 số cuối theo đúng loại giải.
- Tạo settlement và payout.

8. Admin & Audit
- Nhật ký thao tác admin.
- Báo cáo đối soát.

---

## 3) Mô hình dữ liệu (MongoDB)

### 3.1 users
- _id
- username (unique)
- passwordHash
- fullName
- role: user | operator | admin
- status: active | locked
- createdAt, updatedAt

### 3.2 wallets
- _id
- userId (unique)
- balance
- currency (VND)
- updatedAt

### 3.3 wallet_ledger (immutable)
- _id
- userId
- type: deposit | withdraw | reserve | debit | refund | payout
- amount (signed)
- balanceBefore
- balanceAfter
- refType: order | settlement | manual
- refId
- idempotencyKey (nullable)
- createdAt

### 3.4 draws
- _id
- provinceCode: LONG_AN
- drawDate (yyyy-mm-dd)
- openAt (UTC)
- closeAt (UTC)
- settleAt (UTC)
- status: scheduled | open | closed | result_ready | settled
- createdAt, updatedAt

### 3.5 prize_rules
- _id
- drawId
- prizeTier: DB | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8
- matchType: last4
- payoutType: fixed | multiplier
- payoutValue
- isActive
- createdAt, updatedAt

### 3.6 ticket_pool
- _id
- drawId
- prizeTier
- code4 (0000-9999)
- status: available | reserved | sold | settled_win | settled_lose
- reservedBy (userId, nullable)
- reservedUntil (UTC, nullable)
- soldTo (userId, nullable)
- soldAt (UTC, nullable)
- orderId (nullable)
- createdAt, updatedAt

### 3.7 orders
- _id
- userId
- drawId
- status: draft | reserved | confirmed | canceled | settled
- items: [{ ticketId, code4, prizeTier, unitPrice }]
- totalAmount
- idempotencyKey (unique)
- reservedUntil
- confirmedAt
- createdAt, updatedAt

### 3.8 results
- _id
- drawId (unique)
- source
- fetchedAt
- raw
- normalized: {
  DB: ["123456"],
  G1: ["12345"],
  ...
}
- createdAt

### 3.9 settlements
- _id
- drawId
- orderId
- orderItemRef
- userId
- prizeTier
- code4
- matchedNumber
- isWin
- payoutAmount
- status: pending | paid | skipped
- createdAt, updatedAt

### 3.10 payouts
- _id
- settlementId (unique)
- userId
- amount
- ledgerId
- paidAt

### 3.11 audit_logs
- _id
- actorId
- actorRole
- action
- entityType
- entityId
- before
- after
- ip
- userAgent
- createdAt

---

## 4) Index bắt buộc

1. ticket_pool
- unique(drawId, prizeTier, code4)
- index(status, reservedUntil)
- index(drawId, prizeTier, status)

2. orders
- unique(idempotencyKey)
- index(userId, createdAt desc)
- index(drawId, status)

3. results
- unique(drawId)

4. settlements
- index(drawId, userId)
- index(userId, createdAt desc)

5. payouts
- unique(settlementId)

6. wallet_ledger
- index(userId, createdAt desc)
- index(refType, refId)

---

## 5) State machine chuẩn

### Ticket
available -> reserved -> sold -> settled_win|settled_lose

### Order
draft -> reserved -> confirmed -> settled
(draft/reserved có thể -> canceled)

### Draw
scheduled -> open -> closed -> result_ready -> settled

---

## 6) Luồng nghiệp vụ chính

### 6.1 Reserve mã
Input:
- drawId
- items: [{ prizeTier, code4 }]
- idempotencyKey

Bước xử lý:
1) Validate draw đang open và chưa quá closeAt.
2) Transaction:
   - Kiểm tra ticket_pool status=available cho toàn bộ items.
   - Chuyển sang reserved, set reservedBy và reservedUntil (ví dụ +10 phút).
   - Tạo/ghi order status=reserved.
3) Trả về orderId + reservedUntil.

### 6.2 Confirm mua
Input:
- orderId
- idempotencyKey

Bước xử lý:
1) Validate order còn hạn reserve.
2) Transaction:
   - Kiểm tra số dư ví.
   - Ghi wallet_ledger type=debit.
   - ticket_pool reserved -> sold.
   - order reserved -> confirmed.
3) Trả về hóa đơn mua.

### 6.3 Job hết hạn reserve
- Cron mỗi 30-60 giây.
- Tìm ticket reservedUntil < now và order chưa confirmed.
- Trả ticket về available, hủy order/reservation.

### 6.4 Ingest kết quả Long An
- Job theo lịch quay.
- Lấy dữ liệu từ source.
- Chuẩn hóa vào results.normalized theo prizeTier.
- Chuyển draw -> result_ready.

### 6.5 Settlement
1) Đọc toàn bộ ticket sold của draw.
2) Với mỗi ticket:
   - Lấy danh sách số prize tương ứng tier.
   - So last4 với code4.
   - Tính payout theo prize_rules.
3) Tạo settlements.
4) Nếu thắng: tạo payout + ledger credit.
5) Chuyển draw -> settled.

---

## 7) Quy tắc match chính xác theo bài toán

Ví dụ:
- Mã user mua: 6789 ở tier DB.
- Kết quả Long An DB: 1236789 -> last4 = 6789.
- Match đúng tier DB => win theo rule DB.

Không được phép:
- Lấy mã tier DB đi so với G1/G2...
- Trộn tier khi chấm.

Hàm chuẩn hóa:
- normalizeLast4(numberString):
  - giữ ký tự số,
  - lấy 4 số cuối,
  - padStart nếu thiếu.

---

## 8) API contract đề xuất (v1)

### User
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- GET /api/v1/me

### Wallet
- GET /api/v1/wallet
- GET /api/v1/wallet/ledger

### Draw
- GET /api/v1/draws/current
- GET /api/v1/draws/:id

### Ticket & Order
- GET /api/v1/tickets?drawId=&prizeTier=&status=
- POST /api/v1/orders/reserve
- POST /api/v1/orders/confirm
- POST /api/v1/orders/cancel
- GET /api/v1/orders/my

### Result & Settlement
- GET /api/v1/results/:drawId
- GET /api/v1/settlements/my

### Admin
- POST /api/v1/admin/results/ingest
- POST /api/v1/admin/draws/:id/settle
- POST /api/v1/admin/tickets/refill
- GET /api/v1/admin/reconcile/draw/:id

---

## 9) Timezone policy (bắt buộc)

- Nghiệp vụ cutoff theo Asia/Ho_Chi_Minh.
- Lưu DB bằng UTC.
- Khi hiển thị UI/log/report convert về giờ Việt Nam.
- Mọi cron đánh dấu theo múi giờ Việt Nam.

---

## 10) Anti-race & nhất quán dữ liệu

- Mọi thao tác reserve/confirm dùng transaction.
- Unique index bảo vệ lớp DB, không chỉ bảo vệ ở code.
- Dùng idempotencyKey cho reserve, confirm, payout.
- Không cho client gửi payoutAmount; backend tự tính hoàn toàn.

---

## 11) Kế hoạch migrate từ hệ thống hiện tại

### Phase 1 (An toàn, không cắt dịch vụ)
- Tạo collection mới: draws, prize_rules, wallet_ledger, orders, settlements, payouts.
- Bổ sung index bắt buộc.
- Viết script migrate user/wallet cơ bản.

### Phase 2
- Chuyển API mua mã sang reserve/confirm.
- Dashboard admin chỉ gọi API mới.

### Phase 3
- Tích hợp ingest Long An + settlement tự động.
- Chạy song song với log đối chiếu trước khi bật trả thưởng thật.

### Phase 4
- Bật payout thật.
- Khóa API legacy cũ.

### Phase 5
- Tối ưu hiệu năng + cảnh báo vận hành + backup/restore.

---

## 12) Checklist go-live

- [ ] Unique index đã tạo đủ và verified.
- [ ] Reserve timeout job chạy ổn định.
- [ ] Idempotency test pass (retry 2-3 lần không tạo trùng).
- [ ] Settlement test pass với dữ liệu mẫu Long An.
- [ ] Reconcile report khớp giữa sold tickets và settlements.
- [ ] Audit log ghi đủ thao tác admin.
- [ ] Timezone VN hiển thị đúng mọi màn hình.

---

## 13) Đề xuất bước triển khai tiếp theo trong codebase hiện tại

1. Tạo module mới dưới src:
- src/modules/draw
- src/modules/ticket
- src/modules/order
- src/modules/result
- src/modules/settlement
- src/modules/wallet

2. Giữ route cũ để tương thích tạm thời, thêm route v1 mới.

3. Tách service logic khỏi controller để dễ test:
- services/*
- repositories/*
- jobs/*

4. Viết test trọng tâm trước:
- reserve race condition
- confirm idempotency
- settlement chính xác theo tier

---

Nếu muốn, bước tiếp theo mình có thể tạo luôn skeleton folder/module + interface TypeScript cho các domain trên để team bắt đầu code ngay.

---

## 14) Lộ trình chuyển đổi thực thi (6 tuần)

Mục tiêu lộ trình:
- Không downtime.
- Có thể rollback ở từng mốc.
- Đảm bảo số tiền, mã đã mua, và kết quả chấm không sai lệch.

### Tuần 1: Foundation + schema + observability

Phạm vi:
- Tạo collections/index mới (draws, prize_rules, orders, settlements, payouts, wallet_ledger).
- Thêm logging chuẩn cho các flow mua mã hiện tại.
- Thêm correlationId vào request để truy vết.

Deliverables:
- Script tạo index chạy được trên môi trường staging/prod.
- Dashboard monitor cơ bản: error rate, latency, số request reserve/assign.
- Tài liệu mapping dữ liệu cũ -> mới.

Điều kiện pass:
- Index build thành công, không lock kéo dài gây lỗi API.
- Không phát sinh regression ở API cũ.

Rollback:
- Không dùng route mới, chỉ disable feature flag module v1.

### Tuần 2: Wallet ledger + idempotency

Phạm vi:
- Bổ sung wallet_ledger immutable.
- Triển khai idempotency key cho các endpoint mua/confirm (v1).
- Thêm guard chống double-submit từ client.

Deliverables:
- Middleware idempotency dùng chung.
- API v1 wallet/ledger read-only.
- Bộ test retry 3 lần không trừ tiền 2 lần.

Điều kiện pass:
- Mọi giao dịch tiền đều truy ngược được qua ledger.
- Không có duplicate debit trong test song song.

Rollback:
- Giữ ledger ở chế độ ghi shadow, không dùng để quyết toán chính thức.

### Tuần 3: Ticket Pool + Reserve/Confirm (song song hệ cũ)

Phạm vi:
- Triển khai ticket_pool theo draw + tier + code4.
- Tạo API mới:
   - POST /api/v1/orders/reserve
   - POST /api/v1/orders/confirm
   - POST /api/v1/orders/cancel
- Bật shadow-write: thao tác cũ vẫn chạy, đồng thời ghi dữ liệu sang model mới.

Deliverables:
- Transaction reserve/confirm hoạt động ổn định.
- Job expire reserve (30-60 giây/lần).
- Báo cáo so sánh trạng thái mã cũ vs mới.

Điều kiện pass:
- Không có mã bán trùng trong test concurrent.
- Tỷ lệ lệch dữ liệu shadow < 0.1% và có giải thích.

Rollback:
- Tắt feature flag v1 checkout, giữ API cũ phục vụ chính.

### Tuần 4: Result ingestion Long An + Settlement shadow

Phạm vi:
- Dùng API XSKT Long An hiện có để ingest vào results.
- Viết settlement engine chạy shadow (chưa trả thưởng thật).
- So kết quả thắng/thua với rule từng tier (DB/G1...).

Deliverables:
- Job ingest theo lịch.
- Job settlement shadow + bảng reconcile.
- API admin xem mismatch report.

Điều kiện pass:
- Settlement shadow ổn định ít nhất 3 kỳ quay liên tiếp.
- Không mismatch logic tier trong bộ test mẫu.

Rollback:
- Tạm dừng jobs settlement, giữ dữ liệu shadow để phân tích.

### Tuần 5: Cutover mềm cho nhóm nhỏ

Phạm vi:
- Bật luồng mua mã v1 cho 5-10% user (canary).
- Theo dõi sát: latency, lỗi confirm, double charge, timeout reserve.

Deliverables:
- Bảng theo dõi KPI theo giờ.
- Quy trình incident response (on-call + runbook).

Điều kiện pass:
- Error rate không tăng quá ngưỡng cho phép.
- Không phát sinh sự cố tiền/mã nghiêm trọng.

Rollback:
- Giảm traffic canary về 0% trong 1 thao tác config.

### Tuần 6: Cutover 100% + khóa legacy

Phạm vi:
- Chuyển 100% user sang luồng v1.
- Mở payout thật từ settlement engine.
- Đóng các endpoint legacy mua/gán mã không còn cần.

Deliverables:
- Biên bản cutover + snapshot số liệu trước/sau.
- Bản docs vận hành chính thức.

Điều kiện pass:
- Đối soát sold/win/payout khớp 100% theo draw.
- Không còn endpoint legacy được gọi từ app chính.

Rollback:
- Chỉ rollback trong 24h đầu nếu có sự cố cấp P1.
- Sau 24h: xử lý forward-fix có kiểm soát.

---

## 15) Feature flag đề xuất

Biến cấu hình:
- FF_V1_CHECKOUT_ENABLED
- FF_V1_SETTLEMENT_SHADOW_ENABLED
- FF_V1_PAYOUT_ENABLED
- FF_V1_CANARY_PERCENT

Nguyên tắc:
- Mọi thay đổi lớn phải đi qua feature flag.
- Flag có thể bật/tắt runtime (không cần redeploy nếu có thể).

---

## 16) Kế hoạch migrate dữ liệu chi tiết

### Bước A: Snapshot
- Chụp snapshot collections: users, rewardcodes, transactions.
- Ghi checksum tổng record + tổng số mã đã gán.

### Bước B: Backfill draw/tier mặc định
- Với dữ liệu cũ chưa có drawId/prizeTier:
   - gán draw mặc định hiện tại (migration draw).
   - gán tier mặc định theo business rule tạm thời (ví dụ DB) và đánh dấu migrated=true.

### Bước C: Backfill orders
- Từ reward code đã assigned tạo order item lịch sử (status=confirmed, source=legacy_migration).

### Bước D: Verify
- So sánh:
   - số mã assigned cũ == số ticket sold mới
   - số user có mã > 0 khớp giữa 2 hệ

### Bước E: Freeze window (ngắn)
- Khóa thao tác admin xóa/sửa mã trong 5-10 phút khi chạy migration cuối.

---

## 17) Test plan chuyển đổi

### Test kỹ thuật
- Concurrency reserve cùng 1 mã (100 request song song).
- Retry confirm cùng idempotency key (>=3 lần).
- Job expire reserve với clock skew nhỏ.

### Test nghiệp vụ
- Match đúng tier: DB chỉ so DB, G1 chỉ so G1.
- Một user mua nhiều mã nhiều tier trong cùng draw.
- Draw đã closed không được mua mới.

### Test tài chính
- Không âm ví khi confirm.
- Tổng debit = tổng tiền order confirmed.
- Tổng payout = tổng settlements win đã paid.

---

## 18) KPI theo dõi trong giai đoạn chuyển đổi

- Checkout success rate.
- Reserve timeout rate.
- Duplicate transaction rate (mục tiêu 0).
- Mismatch settlement rate.
- P95 latency của reserve/confirm.
- Số incident P1/P2 theo tuần.

Ngưỡng cảnh báo gợi ý:
- checkout success < 99.5%
- duplicate transaction > 0
- mismatch settlement > 0.1%

---

## 19) Runbook ngày cutover

Trước cutover:
- Xác nhận backup hoàn tất.
- Xác nhận tất cả cron và queue healthy.
- Freeze thay đổi code (change freeze).

Trong cutover:
1) Bật canary 10%.
2) Theo dõi 30-60 phút.
3) Nếu ổn: tăng 30% -> 60% -> 100%.

Sau cutover:
- Chạy đối soát theo draw gần nhất.
- Chốt biên bản vận hành + lỗi phát sinh + hướng xử lý.

---

## 20) Ma trận trách nhiệm (RACI rút gọn)

- Backend lead: thiết kế schema, transaction, settlement.
- Dev backend: implement API/jobs/migration scripts.
- QA: test concurrency, nghiệp vụ, regression.
- DevOps: cron, monitor, alert, backup/restore.
- Product/Business: xác nhận rule tier, payout rule, ngưỡng canary.

Khuyến nghị:
- Mỗi phase phải có 1 owner chịu trách nhiệm sign-off.
- Không chuyển phase nếu chưa pass tiêu chí của phase trước.

---

## 21) Cấu hình env rollout khuyến nghị (MVP an toàn)

Mục tiêu:
- Bật dần theo phase, không bật payout sớm.
- Theo dõi rõ trạng thái bằng `/api/v1/system/health`.

### Phase A (Shadow only)

```env
FF_V1_CHECKOUT_ENABLED=true
FF_V1_SETTLEMENT_SHADOW_ENABLED=true
FF_V1_PAYOUT_ENABLED=false
FF_V1_CANARY_PERCENT=10

FF_V1_JOBS_ENABLED=true
FF_V1_JOB_EXPIRE_ENABLED=true
FF_V1_JOB_INGEST_ENABLED=true
FF_V1_JOB_SHADOW_ENABLED=true
FF_V1_JOB_PAYOUT_ENABLED=false

V1_JOB_EXPIRE_INTERVAL_MS=60000
V1_JOB_INGEST_INTERVAL_MS=120000
V1_JOB_SHADOW_INTERVAL_MS=120000
V1_JOB_PAYOUT_INTERVAL_MS=120000
V1_JOB_PAYOUT_BATCH_SIZE=100
```

### Phase B (Canary payout)

```env
FF_V1_PAYOUT_ENABLED=true
FF_V1_JOB_PAYOUT_ENABLED=true
FF_V1_CANARY_PERCENT=30
```

### Phase C (Full cutover)

```env
FF_V1_CANARY_PERCENT=100
```

### Lưu ý triển khai môi trường

- Scheduler chạy qua `src/server.ts` (môi trường process chạy liên tục).
- Nếu chạy serverless, có thể dùng endpoint admin chạy tay: `POST /api/v1/jobs/run-once` với body `{"job":"all"}`.
- Dùng task `verify-v1-jobs-prod` để kiểm tra nhanh trạng thái flags + run-once.

### Vercel Cron (serverless) - production ready

- Đã cấu hình cron trong `vercel.json` gọi `/api/v1/jobs/cron-run?job=all` theo lịch daily (phù hợp Vercel Hobby).
- Bảo mật cron bằng `CRON_SECRET` (header `Authorization: Bearer <CRON_SECRET>`).
- Kiểm tra bằng task `verify-v1-cron-prod` (máy local cần set biến môi trường `CRON_SECRET`).

Lưu ý giới hạn plan:
- Vercel Hobby chỉ cho cron chạy tối đa 1 lần/ngày.
- Nếu cần chạy mỗi phút/5 phút: dùng scheduler ngoài (GitHub Actions, Windows Task Scheduler, hoặc nâng cấp Vercel Pro).

### GitHub Actions Scheduler (khuyến nghị cho chạy mỗi 5 phút)

Repo đã có workflow: `.github/workflows/v1-jobs-scheduler.yml`

- Lịch mặc định: mỗi 5 phút (`*/5 * * * *`).
- Endpoint gọi: `GET /api/v1/jobs/cron-run?job=all`.
- Bảo mật: header `Authorization: Bearer <CRON_SECRET>`.
- Có hỗ trợ chạy tay qua `workflow_dispatch` với input `job` (`all|expire|ingest|shadow|payout`).

Thiết lập secrets trong GitHub repository:

- `BACKEND_BASE_URL` = `https://ttt-backend-mu.vercel.app`
- `CRON_SECRET` = cùng giá trị đã set ở Vercel production env.

Khuyến nghị vận hành:

- Giữ cron daily của Vercel như fallback, hoặc bỏ nếu muốn tránh chạy trùng lịch.
- Nếu bỏ fallback, xóa block `crons` trong `vercel.json` và redeploy.
- Theo dõi tab Actions để thấy log gọi endpoint và HTTP status từng lần chạy.
