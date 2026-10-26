import crypto from 'crypto';
import { SQL_NOW } from './db.js';

export const QUOTA_OFF_SENTINEL = 999;

export function dailyLimit() {
  const raw = String(process.env.DAILY_UPLOAD_LIMIT ?? '').trim();
  if (raw === '') return 3;
  if (!/^\d+$/.test(raw)) {
    throw new Error('DAILY_UPLOAD_LIMIT must be a non-negative integer (0 disables the per-visitor limit)');
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value > 100_000) {
    throw new Error('DAILY_UPLOAD_LIMIT must be between 0 and 100000');
  }
  return value;
}


export const quotaDisabledByConfig = () => dailyLimit() === 0;


export const DAILY_LIMIT_DEFAULT = 3;











const dayOf = (value) => (value ? String(value).slice(0, 10) : null);

export function createRequest({ db }) {
  const consumeQuotaTransaction = db.transaction(({ userId, limit }) => {
    const today = new Date().toISOString().slice(0, 10);
    const row = db
      .prepare('SELECT daily_quota_used, daily_quota_reset FROM users WHERE id = ?')
      .get(userId);
    if (!row) return { allowed: false, remaining: 0 };

    if (dayOf(row.daily_quota_reset) !== today) {
      db.prepare(
        `UPDATE users
         SET daily_quota_used = 1, daily_quota_reset = ${SQL_NOW}
         WHERE id = ?`,
      ).run(userId);
      return { allowed: true, remaining: Math.max(0, limit - 1) };
    }

    
    
    const update = db.prepare(
      `UPDATE users
       SET daily_quota_used = daily_quota_used + 1
       WHERE id = ? AND daily_quota_used < ?`,
    ).run(userId, limit);
    if (update.changes !== 1) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: Math.max(0, limit - 1 - row.daily_quota_used) };
  });

  return {
    validateSession({ userId, visitorHash }) {
      const row = db
        .prepare(
          'SELECT id, daily_quota_used, daily_quota_reset FROM users WHERE id = ? AND cookie_hash = ?',
        )
        .get(userId, visitorHash);
      if (!row) throw new Error('Session metadata mismatch');
      return row;
    },
    createUploadSession({ userId, visitorHash, source }) {
      const formId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO submissions
          (submission_id, user_id, session_id, source, status, created_at)
          VALUES (?, ?, ?, ?, ?, ${SQL_NOW})`,
      ).run(formId, userId, visitorHash, source, 'pending');
      return formId;
    },
    validateSubmission({ userId, formId, source }) {
      if (source === 'new')
        return {
          userId,
          formId,
          source,
          owned: true,
        };
      const row = db
        .prepare(
          'SELECT id FROM submissions WHERE user_id = ? AND submission_id = ?',
        )
        .get(userId, formId);
      if (!row) throw new Error('Submission metadata mismatch');
      return {
        userId,
        formId,
        source,
        owned: true,
      };
    },
    getUploadMetadata({ userId, formId }) {
      const row = db
        .prepare(
          'SELECT * FROM submissions WHERE user_id = ? AND submission_id = ?',
        )
        .get(userId, formId);
      if (!row) throw new Error('Upload metadata not found');
      return row;
    },
    /* DAILY_UPLOAD_LIMIT=0 is the only way the cap is off. There is no
       per-request override: the dev bypass flags that used to supply one are
       gone, and with them the cookie-counted fallback for callers that had no
       user row. The database is the single source of truth. */
    checkQuota({ userId }) {
      const limit = dailyLimit();
      if (limit === 0) {
        return { allowed: true, remaining: QUOTA_OFF_SENTINEL, limit };
      }
      const today = new Date().toISOString().split('T')[0];
      const row = userId == null
        ? null
        : db
          .prepare('SELECT daily_quota_used, daily_quota_reset FROM users WHERE id = ?')
          .get(userId);
      if (!row) return { allowed: false, reason: 'User not found', limit };
      
      
      if (dayOf(row.daily_quota_reset) !== today) {
        db.prepare(
          `UPDATE users SET daily_quota_used = 0, daily_quota_reset = ${SQL_NOW} WHERE id = ?`,
        ).run(userId);
        return { allowed: true, remaining: limit, limit };
      }
      if (row.daily_quota_used >= limit) {
        return { allowed: false, remaining: 0, limit };
      }
      return { allowed: true, remaining: limit - row.daily_quota_used, limit };
    },
    consumeQuota({ userId }) {
      const limit = dailyLimit();
      if (limit === 0) {
        return { allowed: true, remaining: QUOTA_OFF_SENTINEL, limit };
      }

      const exists = userId != null &&
        db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').get(userId);

      if (!exists) return { allowed: false, remaining: 0, limit };

      
      
      return { ...consumeQuotaTransaction({ userId, limit }), limit };
    },
    incrementQuota({ userId }) {
      consumeQuotaTransaction({ userId });
    },
    failUpload({ userId, formId }) {
      db.prepare(
        `UPDATE submissions
         SET status = ?, updated_at = ${SQL_NOW}
         WHERE submission_id = ? AND user_id = ?`,
      ).run('failed', formId, userId);
    },
    finalizeUpload({
      userId,
      // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
      visitorHash,
      formId,
      submitId,
      filename,
      bridgePath,
      originalName,
    }) {
      db.prepare(
        `UPDATE submissions
          SET status      = ?,
          file_name   = ?,
          submit_id   = ?,
          bridge_path = ?,
          updated_at  = ${SQL_NOW}
          WHERE submission_id = ? AND user_id = ?`,
      ).run('processed', originalName || filename, submitId, bridgePath, formId, userId);
    },
  };
}
