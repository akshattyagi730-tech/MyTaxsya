import "dotenv/config";
import { parseGstFromText } from "../services/extractionEngine.js";

const ocrText = `Kanhaa Creations
SHIV SHAKTI NAGAR ,130/197 ,MEERUT CITY
MEERUT UTTER PRADESH (250002), Meerut ,
Uttar Pradesh, 250002
GSTIN: 09HKTPK8224A1ZU Mobile: 6395696482
Email: kanhacrationmeerut@gmail.com
Invoice No. KC/SL/26-27/39 Invoice Date 31/07/2026 Due Date 30/08/2026
HSN CODE 3926 Vehicle No. UP19T6692

BILL TO
KRISHNA HANDICRAFT
Address: BHURTIYA BHAWAN 2322 NAHARGAD ROAD JAIPUR ,
Jaipur , Rajasthan, 302001
GSTIN: 08AHAPK4257E1ZK Place of Supply: Rajasthan
Mobile: 8171073494

SHIP TO
KRISHNA HANDICRAFT
Address: BHURTIYA BHAWAN 2322 NAHARGAD ROAD JAIPUR,
jaipur, Rajasthan, 302001

1 MIX GOD FIGURE STATUE 100 PCS 250 4,500 (18%) 29,500
2 BIG STATUE 50 PCS 400 3,600 (18%) 23,600
3 MODERN ART STAUE 100 PCS 230 4,140 (18%) 27,140
4 Small GOD STATUE 165 PCS 135 4,009.5 (18%) 26,284.5
5 Enimail statue mix 200 PCS 90 3,240 (18%) 21,240
6 BIG STATUE 100 PCS 328 5,904 (18%) 38,704

TOTAL 715 ₹ 25,393.5 ₹ 1,66,468.5
RECEIVED AMOUNT ₹ 0
HSN/SAC Taxable Value IGST Rate Amount Total Tax Amount
- 1,41,075 18% 25,393.5 ₹ 25,393.5
Total Amount (in words) One Lakh Sixty Six Thousand Four Hundred Sixty Eight Rupees and Fifty Paise
Bank Details
Name: Kanhaa Creations
IFSC Code: KKBK0005148
Account No: 3646222201
Bank: Kotak Mahindra Bank ,DELHI ROAD BRANCH
`;

const result = parseGstFromText(ocrText, "Kanhaa_Creations.pdf");
console.log("Direct Text Parser Result:");
console.log(JSON.stringify(result, null, 2));
