var SHEET_NAME = "CollectedInvoices";
var SHARED_SECRET = "";
var START_ROW = 17;
var START_COLUMN = 1;

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

    var actor = body.actor || {};
    var actorName = String(actor.fullName || actor.username || actor.userId || "");
    var actorRole = String(actor.role || "");
    var actorDisplay = actorRole ? actorName + " (" + actorRole + ")" : actorName;

    var startRow = Math.max(sheet.getLastRow() + 1, START_ROW);
    var rows = items.map(function(item, index) {
      var rowNumber = startRow - START_ROW + index + 1;

      return [
        rowNumber,
        String(item.invoiceNumber || ""),
        Number(item.currentAmountValue || 0),
        Number(item.previousAmountValue || 0),
        Number(item.totalAmountValue || 0),
        String(item.customerName || ""),
        String(item.customerAddress || ""),
        String(item.recordBookCode || ""),
        String(item.assignedToName || ""),
        actorDisplay,
        String(item.collectionDateDisplay || ""),
        String(item.billingPeriod || ""),
        "Da thu"
      ];
    });

    sheet
      .getRange(startRow, START_COLUMN, rows.length, rows[0].length)
      .setValues(rows);

    return jsonResponse_({ ok: true, appended: rows.length, startRow: startRow });
  } catch (error) {
    return jsonResponse_({ ok: false, message: String(error) }, 500);
  }
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
