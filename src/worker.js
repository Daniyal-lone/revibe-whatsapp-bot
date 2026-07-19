import 'dotenv/config';
import cron from 'node-cron';
import { enqueueDueReturnReminders, processMarketingQueue, processReceiptQueue } from './workers.js';

async function tick() {
  await processReceiptQueue();
  await enqueueDueReturnReminders();
  await processMarketingQueue();
}

cron.schedule('*/5 * * * *', async () => {
  try {
    await tick();
  } catch (error) {
    console.error('Worker tick failed:', error);
  }
});

console.log('Revibe automation worker started.');
await tick();
