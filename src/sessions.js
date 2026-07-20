import { query } from './db.js';

export async function ensureDailySession(client, actorRole = 'staff') {
  const { rows } = await client.query(
    `
    INSERT INTO daily_sessions (business_date, opened_by_role, status)
    VALUES (CURRENT_DATE, $1, 'open')
    ON CONFLICT (business_date)
    DO UPDATE SET
      status = CASE
        WHEN daily_sessions.status = 'closed' THEN 'open'::session_status
        ELSE daily_sessions.status
      END,
      updated_at = NOW()
    RETURNING *
    `,
    [actorRole]
  );

  return rows[0];
}

export async function recalculateDailySession(client, sessionId) {
  await client.query(
    `
    UPDATE daily_sessions ds
    SET
      total_visits = totals.total_visits,
      total_revenue = totals.total_revenue,
      cash_revenue = totals.cash_revenue,
      upi_revenue = totals.upi_revenue,
      card_revenue = totals.card_revenue,
      insurance_revenue = totals.insurance_revenue,
      updated_at = NOW()
    FROM (
      SELECT
        $1::uuid AS session_id,
        COUNT(*) FILTER (WHERE is_void = FALSE)::int AS total_visits,
        COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE), 0) AS total_revenue,
        COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'cash'), 0) AS cash_revenue,
        COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'upi'), 0) AS upi_revenue,
        COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'card'), 0) AS card_revenue,
        COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'insurance'), 0) AS insurance_revenue
      FROM transactions
      WHERE daily_session_id = $1
    ) totals
    WHERE ds.id = totals.session_id
    `,
    [sessionId]
  );
}

export async function getCurrentSession() {
  const { rows } = await query(
    `
    SELECT *
    FROM daily_sessions
    WHERE business_date = CURRENT_DATE
    LIMIT 1
    `
  );

  return rows[0] || null;
}

