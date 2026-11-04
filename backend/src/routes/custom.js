const router = require('express').Router();
const db = require('../db');
const { z } = require('zod');

const moduleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  description: z.string().max(2000).optional(),
  icon: z.string().max(60).optional()
});

const fieldSchema = z.object({
  field_key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  label: z.string().trim().min(1).max(120),
  field_type: z.enum(['text', 'number', 'date', 'select', 'checkbox', 'textarea', 'email', 'phone']),
  is_required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  sort_order: z.number().int().min(0).optional()
}).refine(data => data.field_type !== 'select' || (data.options && data.options.length > 0), {
  message: 'Select fields must have at least one option',
  path: ['options']
});

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateRecord(data, fields) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Record data must be a JSON object';
  }

  const definitions = new Map(fields.map(field => [field.field_key, field]));
  for (const key of Object.keys(data)) {
    if (!definitions.has(key)) return `Unknown field: ${key}`;
  }

  for (const field of fields) {
    const value = data[field.field_key];
    if (field.is_required && field.field_type === 'checkbox' && value !== true) {
      return `${field.label} is required`;
    }
    if (value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim())) {
      if (field.is_required) return `${field.label} is required`;
      continue;
    }

    switch (field.field_type) {
      case 'text':
      case 'textarea':
      case 'phone':
        if (typeof value !== 'string') return `${field.label} must be text`;
        break;
      case 'email':
        if (typeof value !== 'string' || !z.string().email().safeParse(value).success) {
          return `${field.label} must be a valid email address`;
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) return `${field.label} must be a number`;
        break;
      case 'date':
        if (typeof value !== 'string' || !isValidDate(value)) return `${field.label} must be a valid date`;
        break;
      case 'select':
        if (!field.options.includes(value)) return `Choose a valid option for ${field.label}`;
        break;
      case 'checkbox':
        if (typeof value !== 'boolean') return `${field.label} must be true or false`;
        break;
      default:
        return `Unsupported field type for ${field.label}`;
    }
  }

  return null;
}

async function findActiveModule(id, companyId) {
  return db.query(
    'SELECT id FROM custom_modules WHERE id=$1 AND company_id=$2 AND is_active=TRUE',
    [id, companyId]
  );
}

router.get('/modules', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT m.*, COALESCE(json_agg(f ORDER BY f.sort_order) FILTER (WHERE f.id IS NOT NULL), '[]') fields
       FROM custom_modules m
       LEFT JOIN custom_fields f ON f.module_id=m.id
       WHERE m.company_id=$1 AND m.is_active=TRUE
       GROUP BY m.id
       ORDER BY m.name`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/modules', async (req, res, next) => {
  try {
    const data = moduleSchema.parse(req.body);
    const result = await db.query(
      `INSERT INTO custom_modules(company_id,name,slug,description,icon,created_by,id)
       VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,gen_random_uuid())) RETURNING *`,
      [req.companyId, data.name, data.slug, data.description || null, data.icon || 'layers', req.user.sub, data.id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/modules/:id/fields', async (req, res, next) => {
  try {
    const data = fieldSchema.parse(req.body);
    const module = await findActiveModule(req.params.id, req.companyId);
    if (!module.rowCount) return res.status(404).json({ error: 'Module not found' });

    const result = await db.query(
      `INSERT INTO custom_fields(module_id,field_key,label,field_type,is_required,options,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.params.id,
        data.field_key,
        data.label,
        data.field_type,
        data.is_required || false,
        JSON.stringify(data.options || []),
        data.sort_order || 0
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/modules/:id/records', async (req, res, next) => {
  try {
    const module = await findActiveModule(req.params.id, req.companyId);
    if (!module.rowCount) return res.status(404).json({ error: 'Module not found' });

    const fields = await db.query(
      'SELECT field_key, label, field_type, is_required, options FROM custom_fields WHERE module_id=$1 ORDER BY sort_order',
      [req.params.id]
    );
    const hasManualId = req.body && Object.hasOwn(req.body, '_recordId');
    const recordId = hasManualId ? z.string().uuid().parse(req.body._recordId) : undefined;
    const recordData = { ...req.body };
    delete recordData._recordId;
    const validationError = validateRecord(recordData, fields.rows);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await db.query(
      `INSERT INTO custom_records(company_id,module_id,data,created_by,id)
       VALUES($1,$2,$3,$4,COALESCE($5,gen_random_uuid())) RETURNING *`,
      [req.companyId, req.params.id, JSON.stringify(recordData), req.user.sub, recordId || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/modules/:id/records', async (req, res, next) => {
  try {
    const module = await findActiveModule(req.params.id, req.companyId);
    if (!module.rowCount) return res.status(404).json({ error: 'Module not found' });

    const result = await db.query(
      `SELECT * FROM custom_records
       WHERE company_id=$1 AND module_id=$2
       ORDER BY created_at DESC LIMIT 500`,
      [req.companyId, req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/modules/:id/records/:recordId', async (req, res, next) => {
  try {
    const module = await findActiveModule(req.params.id, req.companyId);
    if (!module.rowCount) return res.status(404).json({ error: 'Module not found' });
    const fields = await db.query(
      'SELECT field_key, label, field_type, is_required, options FROM custom_fields WHERE module_id=$1 ORDER BY sort_order',
      [req.params.id]
    );
    const validationError = validateRecord(req.body, fields.rows);
    if (validationError) return res.status(400).json({ error: validationError });
    const result = await db.query(
      `UPDATE custom_records SET data=$1,updated_at=NOW()
       WHERE id=$2 AND module_id=$3 AND company_id=$4 RETURNING *`,
      [JSON.stringify(req.body), req.params.recordId, req.params.id, req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Custom record not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/modules/:id/records/:recordId', async (req, res, next) => {
  try {
    const module = await findActiveModule(req.params.id, req.companyId);
    if (!module.rowCount) return res.status(404).json({ error: 'Module not found' });
    const result = await db.query(
      'DELETE FROM custom_records WHERE id=$1 AND module_id=$2 AND company_id=$3 RETURNING id',
      [req.params.recordId, req.params.id, req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Custom record not found' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
