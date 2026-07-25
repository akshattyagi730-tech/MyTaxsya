import XLSX from 'xlsx';

const data = [
  { Invoice_Number: 'INV-XLS-001', Invoice_Date: '2026-07-10', Customer_Name: 'XLS Corp', Quantity: 3, Unit_Price: 300 },
  { Invoice_Number: 'INV-XLS-002', Invoice_Date: '2026-07-11', Customer_Name: 'XLS Partners', Quantity: 8, Unit_Price: 120 }
];

const worksheet = XLSX.utils.json_to_sheet(data);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoices');
XLSX.writeFile(workbook, 'scratch/import_valid.xlsx');
console.log('Generated import_valid.xlsx successfully');
