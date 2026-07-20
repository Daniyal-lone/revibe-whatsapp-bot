import { query, withTransaction } from './db.js';
import { normalizePhoneForIndia } from './phone.js';
import { generateReceiptImage } from './receipt.js';
import { ensureDailySession, recalculateDailySession } from './sessions.js';
import { sendWhatsAppImage, sendWhatsAppText } from './whatsapp.js';

function absoluteUrl(relativeUrl) {
  return `${process.env.PUBLIC_BASE_URL}${relativeUrl}`;
}

export async function processReceiptQueue(limit = 10) {
  const receiptStatuses = process.env.WHATSAPP_ENABLED === 'true'
    ? ['pending', 'queued', 'failed']
    : ['pending', 'failed'];

  const { rows } = await query(
    `
    SELECT
      r.id,
      r.receipt_number,
      r.retry_count,
      COALESCE(t.customer_name_snapshot, c.name) AS customer_name,
      COALESCE(t.customer_phone_snapshot, c.phone) AS phone,
      t.transaction_date,
      t.amount_paid,
      t.payment_method,
      s.name AS service_name,
      st.name AS staff_name
    FROM receipts r
    JOIN customers c ON c.id = r.customer_id
    JOIN transactions t ON t.id = r.transaction_id
    JOIN services s ON s.id = t.service_id
    JOIN staff st ON st.id = t.staff_id
    WHERE r.status = ANY($2::receipt_status[])
      AND r.retry_count < r.max_retries
    ORDER BY r.created_at ASC
    LIMIT $1
    `,
    [limit, receiptStatuses]
  );

  for (const receipt of rows) {
    try {
      const image = await generateReceiptImage(receipt);
      const fullImageUrl = absoluteUrl(image.imageUrl);
      const textResult = await sendWhatsAppText({
        phone: receipt.phone,
        body: `Hi ${receipt.customer_name}, your Revibe receipt ${receipt.receipt_number} is ready. Sending the receipt photo now.`
      });
      const imageResult = await sendWhatsAppImage({
        phone: receipt.phone,
        imageUrl: fullImageUrl,
        caption: `Revibe receipt ${receipt.receipt_number}`
      });

      await query(
        `
        UPDATE receipts
        SET
          status = $1,
          image_path = $2,
          image_url = $3,
          text_message_id = $4,
          image_message_id = $5,
          sent_at = NOW(),
          last_error = NULL
        WHERE id = $6
        `,
        [
          process.env.WHATSAPP_ENABLED === 'true' ? 'sent' : 'queued',
          image.imagePath,
          image.imageUrl,
          textResult.providerMessageId,
          imageResult.providerMessageId,
          receipt.id
        ]
      );
    } catch (error) {
      await query(
        `
        UPDATE receipts
        SET status = 'failed', retry_count = retry_count + 1, last_error = $1
        WHERE id = $2
        `,
        [error.message, receipt.id]
      );
    }
  }

  return rows.length;
}

export async function enqueueDueReturnReminders() {
  const { rowCount } = await query(`
    WITH customer_visits AS (
      SELECT
        customer_id,
        transaction_date::date AS visit_date,
        LAG(transaction_date::date) OVER (
          PARTITION BY customer_id
          ORDER BY transaction_date
        ) AS previous_visit_date
      FROM transactions
    ),
    visit_gaps AS (
      SELECT
        customer_id,
        visit_date,
        previous_visit_date,
        visit_date - previous_visit_date AS days_between_visits
      FROM customer_visits
      WHERE previous_visit_date IS NOT NULL
    ),
    customer_return_profile AS (
      SELECT
        customer_id,
        ROUND(AVG(days_between_visits))::integer AS avg_days_between_visits,
        COUNT(*) AS repeat_visit_count
      FROM visit_gaps
      GROUP BY customer_id
    ),
    last_visits AS (
      SELECT
        customer_id,
        MAX(transaction_date::date) AS last_visit_date
      FROM transactions
      GROUP BY customer_id
    ),
    due_customers AS (
      SELECT
        c.id AS customer_id,
        c.name,
        l.last_visit_date + p.avg_days_between_visits AS predicted_due_date
      FROM customers c
      JOIN last_visits l ON l.customer_id = c.id
      JOIN customer_return_profile p ON p.customer_id = c.id
      WHERE p.repeat_visit_count >= 2
        AND c.whatsapp_opt_in = TRUE
        AND c.marketing_opt_out = FALSE
        AND CURRENT_DATE >= GREATEST(
          l.last_visit_date + p.avg_days_between_visits,
          l.last_visit_date + 7
        )
    )
    INSERT INTO marketing_messages (customer_id, due_date, message_body)
    SELECT
      customer_id,
      predicted_due_date,
      'Hi ' || name || ', it may be time for your next Revibe booking. Reply here to reserve your slot.'
    FROM due_customers
    ON CONFLICT (customer_id, message_type, due_date)
    DO NOTHING
  `);

  return rowCount;
}

export async function processMarketingQueue(limit = 10) {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    return 0;
  }

  const { rows } = await query(
    `
    SELECT m.id, m.message_body, c.phone
    FROM marketing_messages m
    JOIN customers c ON c.id = m.customer_id
    WHERE m.status IN ('pending', 'failed')
      AND m.retry_count < m.max_retries
    ORDER BY m.created_at ASC
    LIMIT $1
    `,
    [limit]
  );

  for (const message of rows) {
    try {
      await sendWhatsAppText({ phone: message.phone, body: message.message_body });
      await query(
        `
        UPDATE marketing_messages
        SET status = $1, sent_at = NOW(), last_error = NULL
        WHERE id = $2
        `,
        [process.env.WHATSAPP_ENABLED === 'true' ? 'completed' : 'pending', message.id]
      );
    } catch (error) {
      await query(
        `
        UPDATE marketing_messages
        SET status = 'failed', retry_count = retry_count + 1, last_error = $1
        WHERE id = $2
        `,
        [error.message, message.id]
      );
    }
  }

  return rows.length;
}

export async function createVisit(payload, actorRole = 'staff') {
  const cleanPhone = normalizePhoneForIndia(payload.phone);
  if (!payload.name || !cleanPhone || !payload.staffId || !payload.serviceId || payload.amountPaid === '') {
    const error = new Error('Customer name, phone, staff, service, and amount are required.');
    error.status = 400;
    throw error;
  }

  return withTransaction(async (client) => {
    const session = await ensureDailySession(client, actorRole);
    const customerResult = await client.query(
      `
      INSERT INTO customers (name, phone, preferred_staff_id, preferred_service_id, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (phone)
      DO UPDATE SET
        name = EXCLUDED.name,
        preferred_staff_id = EXCLUDED.preferred_staff_id,
        preferred_service_id = EXCLUDED.preferred_service_id,
        notes = COALESCE(EXCLUDED.notes, customers.notes),
        updated_at = NOW()
      RETURNING *
      `,
      [payload.name.trim(), cleanPhone, payload.staffId, payload.serviceId, payload.notes || null]
    );

    const customer = customerResult.rows[0];
    const transactionResult = await client.query(
      `
      INSERT INTO transactions (
        daily_session_id,
        customer_id,
        customer_name_snapshot,
        customer_phone_snapshot,
        staff_id,
        service_id,
        amount_paid,
        payment_method,
        transaction_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()))
      RETURNING *
      `,
      [
        session.id,
        customer.id,
        payload.name.trim(),
        cleanPhone,
        payload.staffId,
        payload.serviceId,
        Number(payload.amountPaid),
        payload.paymentMethod || 'cash',
        payload.visitDate || null
      ]
    );

    const transaction = transactionResult.rows[0];
    await client.query(
      `
      UPDATE customers
      SET total_visits = total_visits + 1, updated_at = NOW()
      WHERE id = $1
      `,
      [customer.id]
    );

    await client.query(
      `
      INSERT INTO customer_preferences (
        customer_id,
        preferred_staff_id,
        preferred_service_id,
        preference_note
      )
      VALUES ($1, $2, $3, $4)
      `,
      [customer.id, payload.staffId, payload.serviceId, payload.notes || null]
    );

    const receiptNumber = `RCP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const receiptResult = await client.query(
      `
      INSERT INTO receipts (transaction_id, customer_id, receipt_number, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
      `,
      [transaction.id, customer.id, receiptNumber]
    );

    await client.query(
      `
      INSERT INTO audit_logs (actor_role, action, entity_type, entity_id, metadata)
      VALUES ($1, 'create_visit', 'transaction', $2, $3)
      `,
      [actorRole, transaction.id, JSON.stringify({ receiptNumber })]
    );

    await recalculateDailySession(client, session.id);

    return {
      customer,
      transaction,
      receipt: receiptResult.rows[0],
      session
    };
  });
}
