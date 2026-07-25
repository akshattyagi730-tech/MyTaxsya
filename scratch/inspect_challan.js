import XLSX from 'xlsx';

const filePath = '/Users/akshat/Downloads/GST-Challan Receipt - 2026-04-19T115314.731.xlsx';

function inspect() {
  try {
    const workbook = XLSX.readFile(filePath);
    console.log("Sheet names:", workbook.SheetNames);
    
    for (const sheetName of workbook.SheetNames) {
      console.log(`\n--- SHEET: ${sheetName} ---`);
      const worksheet = workbook.Sheets[sheetName];
      
      // Let's get the raw sheet data range
      console.log("Range/Ref:", worksheet['!ref']);
      
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      console.log(`Total rows parsed: ${jsonData.length}`);
      
      console.log("\nFirst 15 rows:");
      jsonData.slice(0, 15).forEach((row, idx) => {
        console.log(`Row ${idx + 1}:`, row);
      });
    }
  } catch (err) {
    console.error("Error inspecting Excel:", err.message);
  }
}

inspect();
