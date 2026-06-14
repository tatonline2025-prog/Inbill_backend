# Collection notification setup

This backend can emit an event whenever an invoice changes from `not_collected` to `collected`.

Supported outputs:
- Telegram message
- Webhook POST (recommended for Google Sheet via Google Apps Script)
- Both at the same time

## Environment variables

Add these variables to the backend `.env` on the production VPS if you want to enable the feature.

```env
INVOICE_COLLECT_TELEGRAM_BOT_TOKEN=
INVOICE_COLLECT_TELEGRAM_CHAT_ID=
INVOICE_COLLECT_TELEGRAM_THREAD_ID=

INVOICE_COLLECT_WEBHOOK_URL=
INVOICE_COLLECT_WEBHOOK_SECRET=
```

Notes:
- Telegram is enabled only when both `INVOICE_COLLECT_TELEGRAM_BOT_TOKEN` and `INVOICE_COLLECT_TELEGRAM_CHAT_ID` are filled.
- Webhook is enabled when `INVOICE_COLLECT_WEBHOOK_URL` is filled.
- `INVOICE_COLLECT_WEBHOOK_SECRET` is optional, but recommended.

## When the event is sent

The backend sends the event when an invoice becomes `collected` from one of these flows:
- Toggle `Da thu`
- Admin update collection date
- Bulk update invoices to `collected`

The backend does not send the event when:
- The invoice was already `collected` and only the date was edited
- The invoice changes from `collected` back to `not_collected`

## Webhook payload

The backend sends JSON like this:

```json
{
  "event": "invoice_collected",
  "source": "toggle_invoice_status",
  "generatedAt": "2026-06-15T09:00:00.000Z",
  "count": 1,
  "actor": {
    "userId": "abc",
    "fullName": "Nguyen Van A",
    "username": "nva",
    "role": "user"
  },
  "items": [
    {
      "invoiceId": "abc",
      "invoiceNumber": "PD0001",
      "customerName": "Tran Thi B",
      "billingPeriod": "05/2026",
      "recordBookCode": "070723020",
      "totalAmountRaw": "1000000",
      "totalAmountValue": 1000000,
      "totalAmountDisplay": "1.000.000 VND",
      "collectionDateIso": "2026-06-15T08:59:00.000Z",
      "collectionDateDisplay": "15:59 15/06/2026",
      "assignedToId": "def",
      "assignedToName": "Nguoi thu 1"
    }
  ],
  "secret": "optional-secret"
}
```

## Google Sheet option

Recommended approach:
1. Create a Google Apps Script Web App bound to the target sheet.
2. Use the sample file `scripts/google_sheet_collected_webhook.gs`.
3. Deploy the script as a Web App.
4. Put the Web App URL into `INVOICE_COLLECT_WEBHOOK_URL`.
5. If you use a secret, put the same value in both the script and `INVOICE_COLLECT_WEBHOOK_SECRET`.

## Telegram option

Steps:
1. Create a Telegram bot with `@BotFather`
2. Get the bot token
3. Add the bot to the target group or channel
4. Get the target `chat_id`
5. Optional: set `INVOICE_COLLECT_TELEGRAM_THREAD_ID` if you want messages inside a forum topic

## Deploy

After updating `.env`, redeploy backend:

```bash
/usr/local/bin/inbill-backend-deploy
```
