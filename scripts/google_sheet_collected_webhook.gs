var SHEET_NAME = "Filter";
var SHARED_SECRET = "";
var START_ROW = 17;
var START_COLUMN = 3;

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

    var startRow = findFirstEmptyRow_(sheet);
    var rows = items.map(function(item) {
      return [
        String(item.invoiceNumber || ""),
        Number(item.currentAmountValue || 0),
        Number(item.previousAmountValue || 0),
        Number(item.totalAmountValue || 0),
        String(item.customerName || ""),
        String(item.customerAddress || ""),
        String(item.recordBookCode || ""),
        String(item.assignedToName || ""),
        String(item.collectionDateDisplay || ""),
        String(item.billingPeriod || "")
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

function findFirstEmptyRow_(sheet) {
  var maxRows = sheet.getMaxRows();
  var values = sheet.getRange(START_ROW, START_COLUMN, maxRows - START_ROW + 1, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === "") {
      return START_ROW + i;
    }
  }

  return Math.max(sheet.getLastRow() + 1, START_ROW);
}
