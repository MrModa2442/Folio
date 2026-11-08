/**
 * IndexedDB storage for local PDF Blobs
 */

const DB_NAME = 'FolioBookDatabase';
const DB_VERSION = 1;
const STORE_NAME = 'pdf_files';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = event => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = event => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function storePdfBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(blob, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPdfBlob(key: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePdfBlob(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function storeBookCover(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(dataUrl, `cover_${key}`);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // non-fatal
  }
}

export async function getBookCover(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const db = await openDatabase();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(`cover_${key}`);
      request.onsuccess = () => {
        resolve(typeof request.result === 'string' ? request.result : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Creates a valid multi-page PDF Blob with correct xref offsets.
 */
export function createSamplePdfBlob(title: string, author: string, summary: string): Blob {
  const safeTitle = escapePdfText(title);
  const safeAuthor = escapePdfText(author);
  const safeSummary = escapePdfText(summary);

  const stream1 = `BT
/F1 26 Tf
60 700 Td
(${safeTitle}) Tj
0 -36 Td
/F2 14 Tf
(${safeAuthor}) Tj
0 -45 Td
/F3 11 Tf
(${escapePdfText('Folio Digital Reading Collection')}) Tj
0 -25 Td
(${escapePdfText('------------------------------------------------------------------------------------------------')}) Tj
0 -30 Td
/F3 12 Tf
(${safeSummary}) Tj
0 -40 Td
/F2 11 Tf
(${escapePdfText('Page 1 of 2 - Scroll or use next arrow to turn pages.')}) Tj
ET`;

  const stream2 = `BT
/F1 22 Tf
60 700 Td
(${safeTitle} - Continued) Tj
0 -40 Td
/F3 12 Tf
(${escapePdfText('Chapter I: Contemplation and Architecture of Thought')}) Tj
0 -30 Td
/F3 11 Tf
(${escapePdfText('A tranquil mind is a fortress of reason and virtue. Each hour holds its own purpose.')}) Tj
0 -40 Td
/F2 11 Tf
(${escapePdfText('Page 2 of 2 - End of volume preview.')}) Tj
ET`;

  // Build document with precise offsets
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R /F3 9 0 R >> >> >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R /F3 9 0 R >> >> >>\nendobj\n';
  const obj5 = `5 0 obj\n<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream\nendobj\n`;
  const obj6 = `6 0 obj\n<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream\nendobj\n`;
  const obj7 = '7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n';
  const obj8 = '8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj\n';
  const obj9 = '9 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  const parts = [header, obj1, obj2, obj3, obj4, obj5, obj6, obj7, obj8, obj9];
  let offset = header.length;
  const offsets = [0];

  for (let i = 1; i < parts.length; i++) {
    offsets.push(offset);
    offset += parts[i].length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const pdfString = parts.join('') + xref + trailer;

  return new Blob([pdfString], { type: 'application/pdf' });
}

function escapePdfText(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
