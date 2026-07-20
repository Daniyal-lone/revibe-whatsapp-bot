import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import TextToSVG from 'text-to-svg';

const receiptDir = path.resolve('storage', 'receipts');
const receiptTemplatePath = path.resolve('public', 'brand', 'revibe-receipt-template.png');
const textToSVG = TextToSVG.loadSync();

function receiptAmount(value) {
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function valuePath(text, x, y, fontSize = 30) {
  const d = textToSVG.getD(String(text || ''), {
    x,
    y,
    fontSize,
    anchor: 'left baseline'
  });

  return `<path fill="#073f3a" d="${d}"/>`;
}

export async function generateReceiptImage(receipt) {
  await fs.mkdir(receiptDir, { recursive: true });

  const fileName = `${receipt.receipt_number}.png`;
  const outputPath = path.join(receiptDir, fileName);
  const date = new Date(receipt.transaction_date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const overlay = `
  <svg width="1024" height="1536" viewBox="0 0 1024 1536" xmlns="http://www.w3.org/2000/svg">
    ${valuePath(receipt.customer_name, 505, 674, 28)}
    ${valuePath(receipt.service_name, 505, 766, 28)}
    ${valuePath(receipt.staff_name, 505, 856, 28)}
    ${valuePath(receiptAmount(receipt.amount_paid), 545, 950, 28)}
    ${valuePath(date, 505, 1040, 24)}
    ${valuePath(receipt.receipt_number, 505, 1134, 24)}
  </svg>`;

  await sharp(receiptTemplatePath)
    .resize(1024, 1536, { fit: 'cover' })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);

  return {
    imagePath: outputPath.replaceAll('\\', '/'),
    imageUrl: `/receipts/${fileName}`
  };
}
