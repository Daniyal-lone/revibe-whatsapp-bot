import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { login, requireRole } from './src/auth.js';
import { query, withTransaction } from './src/db.js';
import { ensureDailySession, getCurrentSession, recalculateDailySession } from './src/sessions.js';
import {
  createVisit,
  enqueueDueReturnReminders,
  processMarketingQueue,
  processReceiptQueue
} from './src/workers.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/receipts', express.static(path.resolve('storage', 'receipts')));
app.use(express.static(path.resolve('public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'revibe-salon-automation' });
});

app.post('/api/auth/login', (req, res, next) => {
  try {
    const token = login(req.body.role, req.body.pin);
    res.json({ token, role: req.body.role });
  } catch (error) {
    next(error);
  }
});

app.get('/api/bootstrap', requireRole('staff'), async (req, res, next) => {
  try {
    const openedSession = await withTransaction((client) => ensureDailySession(client, req.user.role));
    const [staff, services, session] = await Promise.all([
      query('SELECT id, name, role FROM staff WHERE is_active = TRUE ORDER BY name'),
      query('SELECT id, name, category, price FROM services WHERE is_active = TRUE ORDER BY category, name'),
      getCurrentSession()
    ]);
    res.json({ staff: staff.rows, services: services.rows, session: session || openedSession });
  } catch (error) {
    next(error);
  }
});

app.get('/api/customers/search', requireRole('staff'), async (req, res, next) => {
  try {
    const search = `%${req.query.q || ''}%`;
    const result = await query(
      `
      SELECT
        c.id,
        c.name,
        c.phone,
        c.total_visits,
        st.name AS preferred_staff,
        sv.name AS preferred_service
      FROM customers c
      LEFT JOIN staff st ON st.id = c.preferred_staff_id
      LEFT JOIN services sv ON sv.id = c.preferred_service_id
      WHERE c.phone ILIKE $1 OR c.name ILIKE $1
      ORDER BY c.updated_at DESC
      LIMIT 8
      `,
      [search]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/visits', requireRole('staff'), async (req, res, next) => {
  try {
    const result = await createVisit(req.body, req.user.role);
    processReceiptQueue(1).catch((error) => console.error('Receipt queue failed:', error));
    res.status(201).json({
      ok: true,
      message: process.env.WHATSAPP_ENABLED === 'true' ? 'Saved. Receipt sending started.' : 'Saved. Receipt queued.',
      receiptNumber: result.receipt.receipt_number,
      transactionId: result.transaction.id
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/owner/dashboard', requireRole('owner'), async (_req, res, next) => {
  try {
    const [today, failedReceipts, dueMessages, topStaff, recent, session, yesterday, last7] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(amount_paid), 0) AS revenue,
          COUNT(*)::int AS visits
        FROM transactions
        WHERE transaction_date::date = CURRENT_DATE
          AND is_void = FALSE
      `),
      query(`SELECT COUNT(*)::int AS count FROM receipts WHERE status = 'failed'`),
      query(`SELECT COUNT(*)::int AS count FROM marketing_messages WHERE status = 'pending'`),
      query(`
        SELECT st.name, COUNT(*)::int AS visits, COALESCE(SUM(t.amount_paid), 0) AS revenue
        FROM transactions t
        JOIN staff st ON st.id = t.staff_id
        WHERE t.transaction_date >= NOW() - INTERVAL '30 days'
          AND t.is_void = FALSE
        GROUP BY st.name
        ORDER BY revenue DESC
        LIMIT 5
      `),
      query(`
        SELECT
          t.id,
          t.transaction_date,
          COALESCE(t.customer_name_snapshot, c.name) AS customer_name,
          COALESCE(t.customer_phone_snapshot, c.phone) AS phone,
          st.name AS staff_name,
          s.name AS service_name,
          t.amount_paid,
          t.payment_method,
          t.is_void,
          r.status AS receipt_status
        FROM transactions t
        JOIN customers c ON c.id = t.customer_id
        JOIN staff st ON st.id = t.staff_id
        JOIN services s ON s.id = t.service_id
        LEFT JOIN receipts r ON r.transaction_id = t.id
        ORDER BY t.transaction_date DESC
        LIMIT 20
      `),
      getCurrentSession(),
      query(`
        SELECT COALESCE(total_revenue, 0) AS revenue, COALESCE(total_visits, 0) AS visits
        FROM daily_sessions
        WHERE business_date = CURRENT_DATE - INTERVAL '1 day'
      `),
      query(`
        SELECT business_date, total_revenue, total_visits, status
        FROM daily_sessions
        WHERE business_date >= CURRENT_DATE - INTERVAL '6 days'
        ORDER BY business_date DESC
      `)
    ]);

    res.json({
      today: today.rows[0],
      session,
      yesterday: yesterday.rows[0] || { revenue: 0, visits: 0 },
      last7Days: last7.rows,
      failedReceipts: failedReceipts.rows[0].count,
      dueMessages: dueMessages.rows[0].count,
      topStaff: topStaff.rows,
      recentTransactions: recent.rows
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/recent', requireRole('staff'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `
      SELECT
        t.id,
        t.transaction_date,
        COALESCE(t.customer_name_snapshot, c.name) AS customer_name,
        COALESCE(t.customer_phone_snapshot, c.phone) AS phone,
        st.name AS staff_name,
        s.name AS service_name,
        t.amount_paid,
        r.status AS receipt_status
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      JOIN staff st ON st.id = t.staff_id
      JOIN services s ON s.id = t.service_id
      LEFT JOIN receipts r ON r.transaction_id = t.id
      WHERE t.transaction_date::date = CURRENT_DATE
        AND t.is_void = FALSE
      ORDER BY t.transaction_date DESC
      LIMIT 10
      `
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/owner/session/close', requireRole('owner'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `
      UPDATE daily_sessions
      SET status = 'closed', closed_at = NOW(), closed_by_role = $1, updated_at = NOW()
      WHERE business_date = CURRENT_DATE
      RETURNING *
      `,
      [req.user.role]
    );
    res.json({ session: rows[0] || null });
  } catch (error) {
    next(error);
  }
});

app.get('/api/owner/transactions', requireRole('owner'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `
      SELECT
        t.id,
        t.transaction_date,
        COALESCE(t.customer_name_snapshot, c.name) AS customer_name,
        COALESCE(t.customer_phone_snapshot, c.phone) AS phone,
        st.name AS staff_name,
        s.name AS service_name,
        t.amount_paid,
        t.payment_method,
        t.is_void,
        t.void_reason,
        r.receipt_number,
        r.status AS receipt_status
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      JOIN staff st ON st.id = t.staff_id
      JOIN services s ON s.id = t.service_id
      LEFT JOIN receipts r ON r.transaction_id = t.id
      WHERE t.transaction_date >= CURRENT_DATE - ($1::int || ' days')::interval
      ORDER BY t.transaction_date DESC
      LIMIT 100
      `,
      [Number(req.query.days || 7)]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/owner/transactions/:id/void', requireRole('owner'), async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `
        UPDATE transactions
        SET is_void = TRUE, voided_at = NOW(), voided_by_role = $1, void_reason = $2
        WHERE id = $3
        RETURNING *
        `,
        [req.user.role, req.body.reason || 'Owner correction', req.params.id]
      );

      if (!rows[0]) {
        const error = new Error('Transaction not found.');
        error.status = 404;
        throw error;
      }

      if (rows[0].daily_session_id) {
        await recalculateDailySession(client, rows[0].daily_session_id);
      }

      return rows[0];
    });

    res.json({ transaction: result });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/developer/transactions/:id', requireRole('developer'), async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT daily_session_id FROM transactions WHERE id = $1', [req.params.id]);
      const sessionId = rows[0]?.daily_session_id;

      await client.query('DELETE FROM receipts WHERE transaction_id = $1', [req.params.id]);
      await client.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);

      if (sessionId) {
        await recalculateDailySession(client, sessionId);
      }

      return { deleted: true };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/owner/receipts/:id/resend', requireRole('owner'), async (req, res, next) => {
  try {
    await query(
      `
      UPDATE receipts
      SET status = 'pending', retry_count = 0, last_error = NULL
      WHERE id = $1
      `,
      [req.params.id]
    );
    const processed = await processReceiptQueue(5);
    res.json({ processed });
  } catch (error) {
    next(error);
  }
});

app.get('/api/owner/queue', requireRole('owner'), async (_req, res, next) => {
  try {
    const [receipts, messages, webhooks] = await Promise.all([
      query(`
        SELECT r.id, r.receipt_number, r.status, r.retry_count, r.last_error, c.name, c.phone
        FROM receipts r
        JOIN customers c ON c.id = r.customer_id
        WHERE r.status IN ('pending', 'queued', 'failed')
        ORDER BY r.created_at DESC
        LIMIT 50
      `),
      query(`
        SELECT m.id, m.status, m.retry_count, m.last_error, m.due_date, c.name, c.phone
        FROM marketing_messages m
        JOIN customers c ON c.id = m.customer_id
        WHERE m.status IN ('pending', 'failed')
        ORDER BY m.created_at DESC
        LIMIT 50
      `),
      query(`
        SELECT id, source, event_type, status, retry_count, last_error, next_retry_at
        FROM webhook_events
        WHERE status IN ('pending', 'failed')
        ORDER BY created_at DESC
        LIMIT 50
      `)
    ]);

    res.json({ receipts: receipts.rows, messages: messages.rows, webhooks: webhooks.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/owner/run-automation', requireRole('owner'), async (_req, res, next) => {
  try {
    const receipts = await processReceiptQueue();
    const reminders = await enqueueDueReturnReminders();
    const messages = await processMarketingQueue();
    res.json({ receiptsProcessed: receipts, remindersEnqueued: reminders, messagesProcessed: messages });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  console.error(error);
  res.status(status).json({
    error: status === 500 ? 'Something went wrong. The developer has been alerted.' : error.message
  });
});

app.listen(port, () => {
  console.log(`Revibe Salon Automation running on http://localhost:${port}`);
});

if (process.env.ENABLE_INLINE_AUTOMATION !== 'false') {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await processReceiptQueue();
      await enqueueDueReturnReminders();
      await processMarketingQueue();
    } catch (error) {
      console.error('Inline automation failed:', error);
    }
  });
}
