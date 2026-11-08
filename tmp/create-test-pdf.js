import fs from 'node:fs';

function escapePdfText(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function generatePdf(title, author) {
  const safeTitle = escapePdfText(title);
  const safeAuthor = escapePdfText(author);

  const stream1 = `BT
/F1 24 Tf
50 720 Td
(${safeTitle}) Tj
0 -36 Td
/F2 14 Tf
(${safeAuthor}) Tj
0 -40 Td
/F3 11 Tf
(${escapePdfText('BOOK I - OF THOSE THINGS WHICH I HAVE OBSERVED AND LEARNED')}) Tj
0 -24 Td
(${escapePdfText('1. Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion.')}) Tj
0 -20 Td
(${escapePdfText('2. Of the fame and memory which remained of him that begot me, shamefastness and manly behavior.')}) Tj
0 -20 Td
(${escapePdfText('3. Of my mother, godliness, and bountifulness, and to keep myself from doing ill.')}) Tj
0 -20 Td
(${escapePdfText('4. Of my great-grandfather, not to have frequented public schools and auditories, but to have good masters at home.')}) Tj
0 -30 Td
/F2 10 Tf
(${escapePdfText('[Page 1 of 3 - Turn right or press space to read Page 2]')}) Tj
ET`;

  const stream2 = `BT
/F1 20 Tf
50 720 Td
(${safeTitle} - Book II) Tj
0 -36 Td
/F3 12 Tf
(${escapePdfText('Remember how long thou hast already deferred these things, and how often a day hath been given thee.')}) Tj
0 -24 Td
(${escapePdfText('Every hour of the day, mind this, to perform your current duty with serious attention and modesty.')}) Tj
0 -24 Td
(${escapePdfText('Dwell not on idle speculations concerning others, unless it be with reference to some common good.')}) Tj
0 -30 Td
/F2 10 Tf
(${escapePdfText('[Page 2 of 3 - Turn right for Page 3]')}) Tj
ET`;

  const stream3 = `BT
/F1 20 Tf
50 720 Td
(${safeTitle} - Book III) Tj
0 -36 Td
/F3 12 Tf
(${escapePdfText('Man must consider not only that every day a part of his life is used up, but also this:')}) Tj
0 -24 Td
(${escapePdfText('That if he live longer, it is uncertain whether his understanding will continue fitted for affairs.')}) Tj
0 -24 Td
(${escapePdfText('Live as on a mountain. For it makes no difference whether one lives here or there, if everywhere one lives as a citizen of the universe.')}) Tj
0 -30 Td
/F2 10 Tf
(${escapePdfText('[Page 3 of 3 - End of volume]')}) Tj
ET`;

  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 9 0 R /F2 10 0 R /F3 11 0 R >> >> >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R /Resources << /Font << /F1 9 0 R /F2 10 0 R /F3 11 0 R >> >> >>\nendobj\n';
  const obj5 = '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 8 0 R /Resources << /Font << /F1 9 0 R /F2 10 0 R /F3 11 0 R >> >> >>\nendobj\n';
  const obj6 = `6 0 obj\n<< /Length ${Buffer.byteLength(stream1)} >>\nstream\n${stream1}\nendstream\nendobj\n`;
  const obj7 = `7 0 obj\n<< /Length ${Buffer.byteLength(stream2)} >>\nstream\n${stream2}\nendstream\nendobj\n`;
  const obj8 = `8 0 obj\n<< /Length ${Buffer.byteLength(stream3)} >>\nstream\n${stream3}\nendstream\nendobj\n`;
  const obj9 = '9 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n';
  const obj10 = '10 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj\n';
  const obj11 = '11 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  const parts = [header, obj1, obj2, obj3, obj4, obj5, obj6, obj7, obj8, obj9, obj10, obj11];
  let offset = Buffer.byteLength(header);
  const offsets = [0];

  for (let i = 1; i < parts.length; i++) {
    offsets.push(offset);
    offset += Buffer.byteLength(parts[i]);
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat(parts.map(p => Buffer.from(p)).concat([Buffer.from(xref), Buffer.from(trailer)]));
}

const pdfBuf = generatePdf('Meditations', 'Marcus Aurelius');
fs.writeFileSync('/tmp/Marcus_Aurelius_-_Meditations.pdf', pdfBuf);
console.log('PDF written successfully. Size:', pdfBuf.length);
