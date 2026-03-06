const ExcelJS = require("exceljs");

const testData = [
  {
    maKhachHang: "CUST001",
    ten: "Customer A",
    diaChi: "Address A",
    tongTien: "100000",
    kyNay: "50000",
    kyTruoc: "50000",
    tram: "STATION1",
  },
  {
    maKhachHang: "CUST001",
    ten: "Customer A",
    diaChi: "Address A",
    tongTien: "150000",
    kyNay: "75000",
    kyTruoc: "75000",
    tram: "STATION1",
  },
  {
    maKhachHang: "CUST002",
    ten: "Customer B",
    diaChi: "Address B",
    tongTien: "200000",
    kyNay: "100000",
    kyTruoc: "100000",
    tram: "STATION2",
  },
];

const run = async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.columns = [
    { header: "Mã khách hàng", key: "maKhachHang", width: 18 },
    { header: "Tên", key: "ten", width: 24 },
    { header: "Địa chỉ", key: "diaChi", width: 30 },
    { header: "Tổng tiền", key: "tongTien", width: 14 },
    { header: "Kỳ này", key: "kyNay", width: 14 },
    { header: "Kỳ trước", key: "kyTruoc", width: 14 },
    { header: "Trạm", key: "tram", width: 14 },
  ];
  testData.forEach((row) => worksheet.addRow(row));
  await workbook.xlsx.writeFile("test_invoice.xlsx");
  console.log("Test Excel file created: test_invoice.xlsx");
};

run().catch((error) => {
  console.error("Failed to create test Excel file:", error);
  process.exit(1);
});

