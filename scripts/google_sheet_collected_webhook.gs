var SHEET_NAME = "Filter";
var SHARED_SECRET = "";
var START_ROW = 17;
var START_COLUMN = 3; // C
var VALUE_COLUMN_COUNT = 10; // C:L
var EVENT_KEY_COLUMN = 13; // M
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
    var lastRow = Math.max(sheet.getLastRow(), START_ROW - 1);
    var existingKeyMap = buildEventKeyMap_(sheet, lastRow);
    var newRows = [];
    var updatedCount = 0;

    items.forEach(function(item) {
      var rowKey = resolveSheetRowKey_(item);

      var rowValues = buildSheetRow_(item);
      var targetRow = existingKeyMap[rowKey];

      if (targetRow) {
        sheet.getRange(targetRow, START_COLUMN, 1, VALUE_COLUMN_COUNT).setValues([rowValues]);
        sheet.getRange(targetRow, EVENT_KEY_COLUMN).setValue(rowKey);
        updatedCount += 1;
        return;
      }

      newRows.push({ rowKey: rowKey, values: rowValues });
    });

    var appendedCount = 0;
    var startRow = findNextAppendRow_(sheet, lastRow);

    if (newRows.length > 0) {
      ensureSheetHasRows_(sheet, startRow + newRows.length - 1);

      sheet
        .getRange(
          startRow,
          START_COLUMN,
          newRows.length,
          VALUE_COLUMN_COUNT
        )
        .setValues(newRows.map(function(entry) {
          return entry.values;
        }));

      sheet
        .getRange(startRow, EVENT_KEY_COLUMN, newRows.length, 1)
        .setValues(newRows.map(function(entry) {
          return [entry.rowKey];
        }));

      appendedCount = newRows.length;
    }

    SpreadsheetApp.flush();

    return jsonResponse_({
      ok: true,
      appended: appendedCount,
      updated: updatedCount,
      startRow: appendedCount > 0 ? startRow : null
    });
  } catch (error) {
    return jsonResponse_({ ok: false, message: String(error) }, 500);
  } finally {
    lock.releaseLock();
  }
}

function buildSheetRow_(item) {
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
}

function resolveSheetRowKey_(item) {
  var stableKey = String(item.sheetRowKey || "").trim();
  if (stableKey) {
    return stableKey;
  }

  var invoiceId = String(item.invoiceId || "").trim();
  if (invoiceId) {
    return invoiceId;
  }

  var eventKey = String(item.eventKey || "").trim();
  if (eventKey) {
    return normalizeStoredRowKey_(eventKey);
  }

  return String(item.invoiceNumber || "").trim();
}

function buildEventKeyMap_(sheet, lastRow) {
  if (lastRow < START_ROW) {
    return {};
  }

  var keyValues = sheet
    .getRange(START_ROW, EVENT_KEY_COLUMN, lastRow - START_ROW + 1, 1)
    .getValues();
  var result = {};

  for (var i = 0; i < keyValues.length; i++) {
    var storedKey = String(keyValues[i][0] || "").trim();
    if (!storedKey) {
      continue;
    }

    var rowNumber = START_ROW + i;
    result[storedKey] = rowNumber;
    result[normalizeStoredRowKey_(storedKey)] = rowNumber;
  }

  return result;
}

function normalizeStoredRowKey_(value) {
  var normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  var match = normalized.match(/^(.+):\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  if (match && match[1]) {
    return match[1];
  }

  return normalized;
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

function findNextAppendRow_(sheet, lastRow) {
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
