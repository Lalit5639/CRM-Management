const router = require('express').Router();
const db = require('../db');
const { z } = require('zod');

const stages = ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

const configs = {
  leads: {
    table: 'crm_leads',
    fields: ['id', 'name', 'company_name', 'email', 'phone', 'source', 'status', 'notes'],
    schema: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(180),
      company_name: z.string().max(180).nullable().optional(),
      email: z.string().email().max(180).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      source: z.string().max(60).nullable().optional(),
      status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST']).optional(),
      notes: z.string().max(10000).nullable().optional()
    })
  },
  contacts: {
    table: 'crm_contacts',
    fields: ['id', 'name', 'company_name', 'email', 'phone', 'job_title', 'notes'],
    schema: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(180),
      company_name: z.string().max(180).nullable().optional(),
      email: z.string().email().max(180).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      job_title: z.string().max(120).nullable().optional(),
      notes: z.string().max(10000).nullable().optional()
    })
  },
  deals: {
    table: 'crm_deals',
    fields: ['id', 'name', 'amount', 'stage', 'expected_close_date', 'contact_id', 'lead_id', 'notes'],
    schema: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(180),
      amount: z.coerce.number().nonnegative().default(0),
      stage: z.enum(stages).optional(),
      expected_close_date: dateSchema.nullable().optional(),
      contact_id: z.string().uuid().nullable().optional(),
      lead_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(10000).nullable().optional()
    })
  },
  activities: {
    table: 'crm_activities',
    fields: ['id', 'subject', 'activity_type', 'status', 'due_at', 'description', 'lead_id', 'contact_id', 'deal_id'],
    schema: z.object({
      id: z.string().uuid().optional(),
      subject: z.string().trim().min(1).max(180),
      activity_type: z.enum(['CALL', 'EMAIL', 'MEETING', 'TASK']).default('TASK'),
      status: z.enum(['OPEN', 'COMPLETED']).default('OPEN'),
      due_at: z.string().datetime({ offset: true }).nullable().optional(),
      description: z.string().max(10000).nullable().optional(),
      lead_id: z.string().uuid().nullable().optional(),
      contact_id: z.string().uuid().nullable().optional(),
      deal_id: z.string().uuid().nullable().optional()
    })
  }
};

router.get('/summary', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const [leads, contacts, openDeals, pipeline, tasks] = await Promise.all([
      db.query('SELECT COUNT(*)::int count FROM crm_leads WHERE company_id=$1', [companyId]),
      db.query('SELECT COUNT(*)::int count FROM crm_contacts WHERE company_id=$1', [companyId]),
      db.query("SELECT COUNT(*)::int count FROM crm_deals WHERE company_id=$1 AND stage NOT IN ('WON','LOST')", [companyId]),
      db.query("SELECT COALESCE(SUM(amount),0) total FROM crm_deals WHERE company_id=$1 AND stage NOT IN ('WON','LOST')", [companyId]),
      db.query("SELECT COUNT(*)::int count FROM crm_activities WHERE company_id=$1 AND status='OPEN'", [companyId])
    ]);
    res.json({
      leads: leads.rows[0].count,
      contacts: contacts.rows[0].count,
      openDeals: openDeals.rows[0].count,
      pipelineValue: Number(pipeline.rows[0].total),
      openActivities: tasks.rows[0].count
    });
  } catch (error) {
    next(error);
  }
});

for (const [type, config] of Object.entries(configs)) {
  router.get(`/${type}`, async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT * FROM ${config.table} WHERE company_id=$1 ORDER BY created_at DESC LIMIT 500`,
        [req.companyId]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${type}`, async (req, res, next) => {
    try {
      const data = config.schema.parse(req.body);
      const fields = config.fields.filter(field => data[field] !== undefined);
      const columns = ['company_id', ...fields, 'created_by'];
      const values = [req.companyId, ...fields.map(field => data[field]), req.user.sub];
      const placeholders = values.map((value, index) => `$${index + 1}`);
      const result = await db.query(
        `INSERT INTO ${config.table} (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
        values
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${type}/:id`, async (req, res, next) => {
    try {
      const data = config.schema.parse(req.body);
      const fields = config.fields.filter(field => field !== 'id' && data[field] !== undefined);
      const assignments = fields.map((field, index) => `${field}=$${index + 1}`);
      const values = fields.map(field => data[field]);
      values.push(req.params.id, req.companyId);
      const result = await db.query(
        `UPDATE ${config.table} SET ${assignments.join(',')},updated_at=NOW()
         WHERE id=$${values.length - 1} AND company_id=$${values.length} RETURNING *`,
        values
      );
      if (!result.rowCount) return res.status(404).json({ error: 'CRM record not found' });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/${type}/:id`, async (req, res, next) => {
    try {
      const result = await db.query(
        `DELETE FROM ${config.table} WHERE id=$1 AND company_id=$2 RETURNING id`,
        [req.params.id, req.companyId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'CRM record not found' });
      res.json({ id: result.rows[0].id, deleted: true });
    } catch (error) {
      if (error.code === '23503') {
        return res.status(409).json({ error: 'This record is linked to other CRM records. Unlink those records before deleting it.' });
      }
      next(error);
    }
  });
}

for (const [type, config, statusField, allowedStatuses] of [
  ['leads', configs.leads, 'status', ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST']],
  ['deals', configs.deals, 'stage', stages],
  ['activities', configs.activities, 'status', ['OPEN', 'COMPLETED']]
]) {
  const statusSchema = z.object({ [statusField]: z.enum(allowedStatuses) });
  router.patch(`/${type}/:id/status`, async (req, res, next) => {
    try {
      const data = statusSchema.parse(req.body);
      const result = await db.query(
        `UPDATE ${config.table} SET ${statusField}=$1,updated_at=NOW()
         WHERE id=$2 AND company_id=$3 RETURNING *`,
        [data[statusField], req.params.id, req.companyId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'CRM record not found' });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = router;
