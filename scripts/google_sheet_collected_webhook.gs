var SHEET_NAME = "Filter";
var SHARED_SECRET = "";
var START_ROW = 17;
var START_COLUMN = 3;
var LOCK_WAIT_MS = 30000;

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);

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

    var startRow = findNextAppendRow_(sheet);
    ensureSheetHasRows_(sheet, startRow + rows.length - 1);

    sheet
      .getRange(startRow, START_COLUMN, rows.length, rows[0].length)
      .setValues(rows);
    SpreadsheetApp.flush();

    return jsonResponse_({ ok: true, appended: rows.length, startRow: startRow });
  } catch (error) {
    return jsonResponse_({ ok: false, message: String(error) }, 500);
  } finally {
    lock.releaseLock();
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

function findNextAppendRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) {
    return START_ROW;
  }

  var values = sheet.getRange(START_ROW, START_COLUMN, lastRow - START_ROW + 1, 1).getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || "").trim() !== "") {
      return START_ROW + i + 1;
    }
  }

  return START_ROW;
}

function ensureSheetHasRows_(sheet, requiredLastRow) {
  var maxRows = sheet.getMaxRows();
  if (requiredLastRow <= maxRows) {
    return;
  }

  sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
}
