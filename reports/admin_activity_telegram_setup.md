# Telegram cho thông báo thao tác user

Kênh web admin luôn được lưu trước. Kênh Telegram dùng cấu hình riêng của admin, không tự dùng nhóm thu cước.

Đặt các biến trong `.env` của backend đang chạy (`/root/Inbill_backend/.env`):

```dotenv
ADMIN_ACTIVITY_TELEGRAM_BOT_TOKEN=
ADMIN_ACTIVITY_TELEGRAM_CHAT_ID=
# Không bắt buộc, chỉ dùng khi gửi vào một topic của nhóm forum:
ADMIN_ACTIVITY_TELEGRAM_THREAD_ID=
```

Sau khi có cấu hình, tạo lại container để nạp biến môi trường. Bot cần được thêm vào nhóm nhận và có quyền gửi tin; nếu nhận riêng, tài khoản admin phải bấm Start với bot trước.

Chỉ thao tác user phát sinh sau khi cài tích hợp này được xếp hàng Telegram. Thông báo web cũ không tự gửi hàng loạt.
Hệ thống lưu trạng thái gửi, tự thử lại tối đa 5 lần, tôn trọng `retry_after` của Telegram và khôi phục hàng đợi khi khởi động lại.
Admin xem trạng thái trong chi tiết thông báo web; thông báo lỗi có nút gửi lại.
Không ghi bot token vào log, nội dung thông báo hoặc mã nguồn.
