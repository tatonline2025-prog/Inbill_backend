var SHEET_NAME = "CollectedInvoices";
var SHARED_SECRET = "";

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var secret = String(body.secret || "");

    if (SHARED_SECRET && secret !== SHARED_SECRET) {
      return jsonResponse_({ ok: false, message: "Invalid secret" }, 403);
    }

    var items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return jsonResponse_({ ok: false, message: "No items" }, 400);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeader_(sheet);

    var actor = body.actor || {};
    var rows = items.map(function(item) {
      return [
        new Date(),
        String(body.event || ""),
        String(body.source || ""),
        String(actor.fullName || actor.username || actor.userId || ""),
        String(actor.role || ""),
        String(item.invoiceId || ""),
        String(item.invoiceNumber || ""),
        String(item.customerName || ""),
        String(item.billingPeriod || ""),
        String(item.recordBookCode || ""),
        Number(item.totalAmountValue || 0),
        String(item.totalAmountRaw || ""),
        String(item.totalAmountDisplay || ""),
        String(item.collectionDateIso || ""),
        String(item.collectionDateDisplay || ""),
        String(item.assignedToId || ""),
        String(item.assignedToName || "")
      ];
    });

    sheet
      .getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
      .setValues(rows);

    return jsonResponse_({ ok: true, appended: rows.length });
  } catch (error) {
    return jsonResponse_({ ok: false, message: String(error) }, 500);
  }
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;

  sheet.appendRow([
    "receivedAt",
    "event",
    "source",
    "actorName",
    "actorRole",
    "invoiceId",
    "invoiceNumber",
    "customerName",
    "billingPeriod",
    "recordBookCode",
    "totalAmountValue",
    "totalAmountRaw",
    "totalAmountDisplay",
    "collectionDateIso",
    "collectionDateDisplay",
    "assignedToId",
    "assignedToName"
  ]);
}

function jsonResponse_(payload, statusCode) {
  var output = ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);

  if (statusCode && output.setResponseCode) {
    output.setResponseCode(statusCode);
  }

  return output;
}
