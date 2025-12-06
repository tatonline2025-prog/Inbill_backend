// utils/generateTransactionExcel.ts
import ExcelJS from "exceljs";

export const generateTransactionExcel = async (data: any[], sheetName: string) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName || "Sheet 1");

  // 1. Khai báo cột
  worksheet.columns = Object.keys(data[0]).map((key) => ({
    header: key,
    key: key,
    width: 25,
  }));

  // 2. Thêm dữ liệu vào sheet
  data.forEach((item) => {
    worksheet.addRow(item);
  });

  // 3. Style header
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDCE6F1" },
    };
  });

  // 4. Auto fit height
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.height = 22;
  });

  // 5. Xuất buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};
