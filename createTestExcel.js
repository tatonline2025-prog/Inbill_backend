const XLSX = require('xlsx');

// Create test data with duplicate customer codes
const testData = [
  {
    "Mã khách hàng": "CUST001",
    "Tên": "Customer A",
    "Địa chỉ": "Address A",
    "Tổng tiền": "100000",
    "Kỳ này": "50000",
    "Kỳ trước": "50000",
    "Trạm": "STATION1"
  },
  {
    "Mã khách hàng": "CUST001", // Duplicate customer code
    "Tên": "Customer A",
    "Địa chỉ": "Address A",
    "Tổng tiền": "150000", // Different amount
    "Kỳ này": "75000",
    "Kỳ trước": "75000",
    "Trạm": "STATION1"
  },
  {
    "Mã khách hàng": "CUST002",
    "Tên": "Customer B",
    "Địa chỉ": "Address B",
    "Tổng tiền": "200000",
    "Kỳ này": "100000",
    "Kỳ trước": "100000",
    "Trạm": "STATION2"
  }
];

// Create workbook and worksheet
const worksheet = XLSX.utils.json_to_sheet(testData);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

// Write to file
XLSX.writeFile(workbook, 'test_invoice.xlsx');

console.log('Test Excel file created: test_invoice.xlsx');
