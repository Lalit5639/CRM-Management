const router = require('express').Router();
const db = require('../db');
const { z } = require('zod');
const configs = {
  parties: {
    table: 'parties',
    fields: ['id', 'party_code', 'name', 'party_type', 'gstin', 'pan', 'phone', 'email', 'billing_address', 'shipping_address', 'state', 'credit_limit'],
    schema: z.object({
      id: z.string().uuid().optional(),
      party_code: z.string().max(50).optional().nullable(),
      name: z.string().trim().min(1).max(180),
      party_type: z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']),
      gstin: z.string().trim().toUpperCase().max(15).optional().nullable(),
      pan: z.string().trim().toUpperCase().max(10).optional().nullable(),
      phone: z.string().max(30).optional().nullable(),
      email: z.string().trim().email().max(180).optional().nullable(),
      billing_address: z.string().optional().nullable(),
      shipping_address: z.string().optional().nullable(),
      state: z.string().max(100).optional().nullable(),
      credit_limit: z.coerce.number().nonnegative().optional()
    })
  },
  products: {
    table: 'products',
    fields: ['id', 'sku', 'name', 'category', 'hsn_code', 'unit', 'pack_size', 'sale_rate', 'purchase_rate', 'gst_rate', 'track_inventory'],
    schema: z.object({
      id: z.string().uuid().optional(),
      sku: z.string().max(80).optional().nullable(),
      name: z.string().trim().min(1).max(180),
      category: z.string().max(100).optional().nullable(),
      hsn_code: z.string().max(20).optional().nullable(),
      unit: z.string().trim().min(1).max(20).default('BAG'),
      pack_size: z.coerce.number().nonnegative().optional().nullable(),
      sale_rate: z.coerce.number().nonnegative().optional(),
      purchase_rate: z.coerce.number().nonnegative().optional(),
      gst_rate: z.coerce.number().min(0).max(100).optional(),
      track_inventory: z.boolean().optional()
    })
  }
};

router.get('/:type', async (req, res, next) => {
  try {
    const config = configs[req.params.type];
    if (!config) return res.status(404).json({ error: 'Unknown master' });
    const result = await db.query(
      `SELECT * FROM ${config.table} WHERE company_id=$1 AND is_active=TRUE ORDER BY name LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/:type', async (req, res, next) => {
  try {
    const config = configs[req.params.type];
    if (!config) return res.status(404).json({ error: 'Unknown master' });
    const data = config.schema.parse(req.body);
    const fields = config.fields.filter(field => data[field] !== undefined);
    const columns = ['company_id', ...fields];
    const values = [req.companyId, ...fields.map(field => data[field])];
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

router.put('/:type/:id', async (req, res, next) => {
  try {
    const config = configs[req.params.type];
    if (!config) return res.status(404).json({ error: 'Unknown master' });
    const data = config.schema.parse(req.body);
    const fields = config.fields.filter(field => field !== 'id' && data[field] !== undefined);
    const assignments = fields.map((field, index) => `${field}=$${index + 1}`);
    const values = fields.map(field => data[field]);
    values.push(req.params.id, req.companyId);
    const result = await db.query(
      `UPDATE ${config.table} SET ${assignments.join(',')}
       WHERE id=$${values.length - 1} AND company_id=$${values.length} AND is_active=TRUE RETURNING *`,
      values
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Active master record not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/:type/:id', async (req, res, next) => {
  try {
    const config = configs[req.params.type];
    if (!config) return res.status(404).json({ error: 'Unknown master' });
    const result = await db.query(
      `UPDATE ${config.table} SET is_active=FALSE
       WHERE id=$1 AND company_id=$2 AND is_active=TRUE RETURNING id`,
      [req.params.id, req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Active master record not found' });
    res.json({ id: result.rows[0].id, archived: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
