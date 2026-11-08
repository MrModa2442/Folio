import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfMetadata } from './pdfParser';

test('extractPdfMetadata parses page count and metadata from minimal PDF buffer', async () => {
  const dummyPdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 42 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Type /Info /Title (Deep Work) /Author (Cal Newport) >>
endobj
%%EOF`;

  const blob = new Blob([dummyPdf], { type: 'application/pdf' });
  const file = new File([blob], 'random_file_name.pdf', { type: 'application/pdf' });

  const result = await extractPdfMetadata(file);
  assert.equal(result.pageCount, 42);
  assert.equal(result.title, 'Deep Work');
  assert.equal(result.author, 'Cal Newport');
});

test('extractPdfMetadata falls back to filename if internal metadata is missing', async () => {
  const dummyPdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 120 >>
endobj
%%EOF`;

  const blob = new Blob([dummyPdf], { type: 'application/pdf' });
  const file = new File([blob], 'Marcus Aurelius - Meditations.pdf', { type: 'application/pdf' });

  const result = await extractPdfMetadata(file);
  assert.equal(result.pageCount, 120);
  assert.equal(result.title, 'Meditations');
  assert.equal(result.author, 'Marcus Aurelius');
});
