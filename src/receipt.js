import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const receiptDir = path.resolve('storage', 'receipts');
const receiptTemplatePath = path.resolve('public', 'brand', 'revibe-receipt-template.png');

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
    <style>
      .value { fill: #073f3a; font-family: Arial, sans-serif; font-size: 30px; font-weight: 700; }
      .small { fill: #073f3a; font-family: Arial, sans-serif; font-size: 24px; font-weight: 600; }
    </style>
    <text class="value" x="505" y="674">${escapeXml(receipt.customer_name)}</text>
    <text class="value" x="505" y="766">${escapeXml(receipt.service_name)}</text>
    <text class="value" x="505" y="856">${escapeXml(receipt.staff_name)}</text>
    <text class="value" x="545" y="950">${escapeXml(receiptAmount(receipt.amount_paid))}</text>
    <text class="small" x="505" y="1040">${escapeXml(date)}</text>
    <text class="small" x="505" y="1134">${escapeXml(receipt.receipt_number)}</text>
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
