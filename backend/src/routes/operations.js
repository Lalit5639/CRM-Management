const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid date');
const optionalId = z.string().uuid().optional();

const orderStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIAL', 'COMPLETED', 'CANCELLED'];
const dispatchStatuses = ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const paymentModes = ['CASH', 'BANK', 'UPI', 'CHEQUE', 'NEFT', 'RTGS', 'OTHER'];
const itemsSchema = z.array(z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
  tax_rate: z.coerce.number().min(0).max(100).optional()
}).refine(item => item.discount <= item.quantity * item.rate, {
  message: 'A line discount cannot exceed its line amount',
  path: ['discount']
})).min(1).max(200);

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateLines(items) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const lines = items.map(item => {
    const gross = roundMoney(item.quantity * item.rate);
    const base = roundMoney(gross - item.discount);
    const taxRate = item.tax_rate || 0;
    const tax = roundMoney(base * taxRate / 100);
    const total = roundMoney(base + tax);
    subtotal = roundMoney(subtotal + gross);
    discountTotal = roundMoney(discountTotal + item.discount);
    taxTotal = roundMoney(taxTotal + tax);
    return { ...item, tax_rate: taxRate, line_total: total };
  });
  return {
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    grandTotal: roundMoney(subtotal - discountTotal + taxTotal)
  };
}

async function transaction(res, next, work, status = 200) {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    res.status(status).json(result);
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back transaction:', rollbackError);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
  }
}

async function requireParty(client, companyId, partyId, acceptedTypes) {
  const result = await client.query(
    'SELECT id,party_type FROM parties WHERE id=$1 AND company_id=$2 AND is_active=TRUE',
    [partyId, companyId]
  );
  if (!result.rowCount || !acceptedTypes.includes(result.rows[0].party_type) && result.rows[0].party_type !== 'BOTH') {
    const error = new Error('Select an active party with the correct customer or supplier type');
    error.status = 400;
    throw error;
  }
  return result.rows[0];
}

async function requireProducts(client, companyId, items) {
  const ids = [...new Set(items.map(item => item.product_id))];
  const result = await client.query(
    'SELECT id,name,sku,gst_rate,purchase_rate,track_inventory FROM products WHERE company_id=$1 AND is_active=TRUE AND id=ANY($2::uuid[])',
    [companyId, ids]
  );
  if (result.rowCount !== ids.length) {
    const error = new Error('One or more products are inactive or do not belong to this company');
    error.status = 400;
    throw error;
  }
  const products = new Map(result.rows.map(product => [product.id, product]));
  return items.map(item => ({
    ...item,
    tax_rate: item.tax_rate === undefined ? Number(products.get(item.product_id).gst_rate) : item.tax_rate
  }));
}

async function insertLines(client, table, parentColumn, parentId, items, kind) {
  const inserted = [];
  for (const item of items) {
    let result;
    if (kind === 'sales') {
      result = await client.query(
        `INSERT INTO ${table}(${parentColumn},product_id,ordered_qty,rate,discount,tax_rate,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [parentId, item.product_id, item.quantity, item.rate, item.discount, item.tax_rate, item.line_total]
      );
    } else if (kind === 'purchase') {
      result = await client.query(
        `INSERT INTO ${table}(${parentColumn},product_id,quantity,rate,discount,tax_rate,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [parentId, item.product_id, item.quantity, item.rate, item.discount, item.tax_rate, item.line_total]
      );
    } else {
      result = await client.query(
        `INSERT INTO ${table}(invoice_id,product_id,description,quantity,rate,tax_rate,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [parentId, item.product_id, item.description, item.quantity, item.rate, item.tax_rate, item.line_total]
      );
    }
    inserted.push(result.rows[0]);
  }
  return inserted;
}

async function requireWarehouse(client, companyId, warehouseId) {
  const result = await client.query(
    'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2',
    [warehouseId, companyId]
  );
  if (!result.rowCount) {
    const error = new Error('Select a warehouse belonging to this company');
    error.status = 400;
    throw error;
  }
}

router.get('/settings', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id,name,legal_name,gstin,gst_registered,gst_state,email,phone,address,currency FROM companies WHERE id=$1',
      [req.companyId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/settings', async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(2).max(180),
      legal_name: z.string().max(220).nullable().optional(),
      gstin: z.string().trim().toUpperCase().max(15).nullable().optional(),
      gst_registered: z.boolean(),
      gst_state: z.string().max(100).nullable().optional(),
      email: z.string().trim().email().max(180).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      address: z.string().max(4000).nullable().optional()
    }).parse(req.body);
    const result = await db.query(
      `UPDATE companies SET name=$1,legal_name=$2,gstin=$3,gst_registered=$4,gst_state=$5,email=$6,phone=$7,address=$8
       WHERE id=$9 RETURNING id,name,legal_name,gstin,gst_registered,gst_state,email,phone,address,currency`,
      [data.name, data.legal_name || null, data.gstin || null, data.gst_registered, data.gst_state || null,
        data.email || null, data.phone || null, data.address || null, req.companyId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/warehouses', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT w.id,w.name,w.branch_id,
       EXISTS(SELECT 1 FROM stock_movements sm WHERE sm.warehouse_id=w.id AND sm.company_id=w.company_id) has_movements
       FROM warehouses w WHERE w.company_id=$1 ORDER BY w.name`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/warehouses/:id', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    const result = await db.query(
      'UPDATE warehouses SET name=$1 WHERE id=$2 AND company_id=$3 RETURNING id,name,branch_id',
      [name,req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/warehouses/:id', async (req, res, next) => {
  try {
    await transaction(res, next, async client => {
      const warehouse = await client.query(
        'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id,req.companyId]
      );
      if (!warehouse.rowCount) {
        const error = new Error('Warehouse not found');
        error.status = 404;
        throw error;
      }
      const movements = await client.query(
        'SELECT EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id=$1 AND company_id=$2) has_movements',
        [req.params.id,req.companyId]
      );
      const count = await client.query('SELECT COUNT(*)::int count FROM warehouses WHERE company_id=$1', [req.companyId]);
      if (movements.rows[0].has_movements || count.rows[0].count <= 1) {
        const error = new Error('A warehouse with stock history or the company’s last warehouse cannot be deleted');
        error.status = 409;
        throw error;
      }
      await client.query('DELETE FROM warehouses WHERE id=$1 AND company_id=$2', [req.params.id,req.companyId]);
      return { id: req.params.id, deleted: true };
    });
  } catch (error) {
    next(error);
  }
});

router.post('/warehouses', async (req, res, next) => {
  try {
    const data = z.object({ id: optionalId, name: z.string().trim().min(1).max(120) }).parse(req.body);
    const result = await db.query(
      'INSERT INTO warehouses(company_id,name,id) VALUES($1,$2,COALESCE($3,gen_random_uuid())) RETURNING *',
      [req.companyId, data.name, data.id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/sales-orders', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT so.*,p.name AS party_name,
       COALESCE(json_agg(json_build_object('id',si.id,'product_id',si.product_id,'product_name',pr.name,'sku',pr.sku,
         'quantity',si.ordered_qty,'rate',si.rate,'discount',si.discount,'tax_rate',si.tax_rate,'line_total',si.line_total))
         FILTER(WHERE si.id IS NOT NULL),'[]') AS items
       FROM sales_orders so
       JOIN parties p ON p.id=so.party_id AND p.company_id=so.company_id
       LEFT JOIN sales_order_items si ON si.order_id=so.id
       LEFT JOIN products pr ON pr.id=si.product_id AND pr.company_id=so.company_id
       WHERE so.company_id=$1 GROUP BY so.id,p.name ORDER BY so.created_at DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/sales-orders', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      order_no: z.string().trim().min(1).max(60),
      party_id: z.string().uuid(),
      order_date: date,
      notes: z.string().max(10000).nullable().optional(),
      items: itemsSchema
    }).parse(req.body);
    await transaction(res, next, async client => {
      await requireParty(client, req.companyId, input.party_id, ['CUSTOMER']);
      const items = await requireProducts(client, req.companyId, input.items);
      const companyTax = await client.query('SELECT gst_registered FROM companies WHERE id=$1',[req.companyId]);
      if (!companyTax.rows[0].gst_registered) items.forEach(item => { item.tax_rate = 0; });
      const totals = calculateLines(items);
      const order = await client.query(
        `INSERT INTO sales_orders(company_id,order_no,party_id,order_date,status,subtotal,discount_total,tax_total,grand_total,notes,created_by,id)
         VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,COALESCE($11,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.order_no,input.party_id,input.order_date,totals.subtotal,totals.discountTotal,
          totals.taxTotal,totals.grandTotal,input.notes || null,req.user.sub,input.id || null]
      );
      const lines = await insertLines(client,'sales_order_items','order_id',order.rows[0].id,totals.lines,'sales');
      return { ...order.rows[0], items: lines };
    }, 201);
  } catch (error) {
    next(error);
  }
});

router.put('/sales-orders/:id', async (req, res, next) => {
  try {
    const input = z.object({
      order_no: z.string().trim().min(1).max(60),
      party_id: z.string().uuid(),
      order_date: date,
      notes: z.string().max(10000).nullable().optional(),
      items: itemsSchema
    }).parse(req.body);
    await transaction(res, next, async client => {
      const current = await client.query(
        'SELECT id,status FROM sales_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id, req.companyId]
      );
      if (!current.rowCount || current.rows[0].status !== 'DRAFT') {
        const error = new Error('Only draft sales orders can be edited');
        error.status = 409;
        throw error;
      }
      await requireParty(client, req.companyId, input.party_id, ['CUSTOMER']);
      const items = await requireProducts(client, req.companyId, input.items);
      const companyTax = await client.query('SELECT gst_registered FROM companies WHERE id=$1', [req.companyId]);
      if (!companyTax.rows[0].gst_registered) items.forEach(item => { item.tax_rate = 0; });
      const totals = calculateLines(items);
      const order = await client.query(
        `UPDATE sales_orders SET order_no=$1,party_id=$2,order_date=$3,subtotal=$4,discount_total=$5,
         tax_total=$6,grand_total=$7,notes=$8 WHERE id=$9 AND company_id=$10 RETURNING *`,
        [input.order_no,input.party_id,input.order_date,totals.subtotal,totals.discountTotal,
          totals.taxTotal,totals.grandTotal,input.notes || null,req.params.id,req.companyId]
      );
      await client.query('DELETE FROM sales_order_items WHERE order_id=$1', [req.params.id]);
      const lines = await insertLines(client, 'sales_order_items', 'order_id', req.params.id, totals.lines, 'sales');
      return { ...order.rows[0], items: lines };
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/sales-orders/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM sales_orders so WHERE so.id=$1 AND so.company_id=$2 AND so.status='DRAFT'
       AND NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.order_id=so.id)
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id=so.id) RETURNING so.id`,
      [req.params.id, req.companyId]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Only unlinked draft sales orders can be deleted' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (error) {
    next(error);
  }
});

router.patch('/sales-orders/:id/status', async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(orderStatuses) }).parse(req.body);
    const result = await db.query(
      `UPDATE sales_orders SET status=$1 WHERE id=$2 AND company_id=$3
       AND ((status='DRAFT' AND $1 IN ('SUBMITTED','CANCELLED'))
         OR (status='SUBMITTED' AND $1 IN ('APPROVED','CANCELLED'))
         OR (status IN ('APPROVED','PARTIAL') AND $1='CANCELLED')) RETURNING *`,
      [status,req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(400).json({ error: 'Order not found or this status transition is not allowed' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/dispatches', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT d.*,p.name AS party_name,so.order_no
       FROM dispatches d JOIN parties p ON p.id=d.party_id AND p.company_id=d.company_id
       LEFT JOIN sales_orders so ON so.id=d.order_id AND so.company_id=d.company_id
       WHERE d.company_id=$1 ORDER BY d.created_at DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/dispatches', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      dispatch_no: z.string().trim().min(1).max(60),
      party_id: z.string().uuid(),
      order_id: z.string().uuid().nullable().optional(),
      dispatch_date: date,
      warehouse_id: z.string().uuid(),
      vehicle_no: z.string().max(30).nullable().optional(),
      driver_name: z.string().max(120).nullable().optional(),
      driver_phone: z.string().max(30).nullable().optional(),
      transporter_name: z.string().max(160).nullable().optional(),
      lr_no: z.string().max(80).nullable().optional(),
      eway_bill_no: z.string().max(80).nullable().optional(),
      freight: z.coerce.number().nonnegative().default(0),
      items: z.array(z.object({
        product_id: z.string().uuid(),
        order_item_id: z.string().uuid().nullable().optional(),
        quantity: z.coerce.number().positive()
      })).min(1).max(200)
    }).parse(req.body);
    await transaction(res, next, async client => {
      await requireParty(client,req.companyId,input.party_id,['CUSTOMER']);
      await requireWarehouse(client,req.companyId,input.warehouse_id);
      const products = await requireProducts(client,req.companyId,input.items.map(item => ({
        ...item, rate: 0, quantity: item.quantity, discount: 0
      })));

      let order = null;
      if (input.order_id) {
        const orderResult = await client.query(
          `SELECT id,party_id,status FROM sales_orders
           WHERE id=$1 AND company_id=$2 FOR UPDATE`,
          [input.order_id,req.companyId]
        );
        if (!orderResult.rowCount || orderResult.rows[0].party_id !== input.party_id ||
            !['APPROVED','PARTIAL'].includes(orderResult.rows[0].status)) {
          const error = new Error('Dispatch requires an approved order for the selected customer');
          error.status = 400;
          throw error;
        }
        order = orderResult.rows[0];
      }

      const dispatch = await client.query(
        `INSERT INTO dispatches(company_id,dispatch_no,order_id,party_id,dispatch_date,vehicle_no,driver_name,
          driver_phone,transporter_name,lr_no,eway_bill_no,freight,created_by,id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.dispatch_no,input.order_id || null,input.party_id,input.dispatch_date,input.vehicle_no || null,
          input.driver_name || null,input.driver_phone || null,input.transporter_name || null,input.lr_no || null,
          input.eway_bill_no || null,input.freight,req.user.sub,input.id || null]
      );

      for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        const product = products[index];
        if (order && !item.order_item_id) {
          const orderLine = await client.query(
            `SELECT si.id,si.ordered_qty-COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN di.quantity ELSE 0 END),0) AS remaining
             FROM sales_order_items si
             LEFT JOIN dispatch_items di ON di.order_item_id=si.id
             LEFT JOIN dispatches d ON d.id=di.dispatch_id AND d.status<>'CANCELLED'
             WHERE si.order_id=$1 AND si.product_id=$2
             GROUP BY si.id
             HAVING si.ordered_qty-COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN di.quantity ELSE 0 END),0) >= $3
             ORDER BY si.id LIMIT 1`,
            [input.order_id,item.product_id,item.quantity]
          );
          if (!orderLine.rowCount) {
            const error = new Error('No matching order line has enough quantity remaining to dispatch');
            error.status = 400;
            throw error;
          }
          item.order_item_id = orderLine.rows[0].id;
        }
        if (item.order_item_id) {
          const orderLine = await client.query(
            `SELECT id,product_id,ordered_qty FROM sales_order_items WHERE id=$1 AND order_id=$2`,
            [item.order_item_id,input.order_id]
          );
          if (!orderLine.rowCount || orderLine.rows[0].product_id !== item.product_id) {
            const error = new Error('Dispatch item does not match the selected order');
            error.status = 400;
            throw error;
          }
          const dispatched = await client.query(
            `SELECT COALESCE(SUM(di.quantity),0) quantity
             FROM dispatch_items di JOIN dispatches d ON d.id=di.dispatch_id
             WHERE di.order_item_id=$1 AND d.company_id=$2 AND d.status<>'CANCELLED'`,
            [item.order_item_id,req.companyId]
          );
          if (Number(dispatched.rows[0].quantity) + item.quantity > Number(orderLine.rows[0].ordered_qty)) {
            const error = new Error('Dispatch quantity exceeds the order quantity remaining');
            error.status = 400;
            throw error;
          }
        }
        await client.query(
          'INSERT INTO dispatch_items(dispatch_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,$4)',
          [dispatch.rows[0].id,item.order_item_id || null,item.product_id,item.quantity]
        );
        if (product.track_inventory) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.companyId}:${input.warehouse_id}:${item.product_id}`]);
          const stock = await client.query(
            `SELECT COALESCE(SUM(quantity_in-quantity_out),0) quantity
             FROM stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3`,
            [req.companyId,input.warehouse_id,item.product_id]
          );
          if (Number(stock.rows[0].quantity) < item.quantity) {
            const error = new Error(`Insufficient stock for ${product.name}`);
            error.status = 400;
            throw error;
          }
          await client.query(
            `INSERT INTO stock_movements(company_id,warehouse_id,product_id,movement_date,movement_type,
              reference_type,reference_id,quantity_out)
             VALUES($1,$2,$3,$4,'SALE','DISPATCH',$5,$6)`,
            [req.companyId,input.warehouse_id,item.product_id,input.dispatch_date,dispatch.rows[0].id,item.quantity]
          );
        }
      }
      if (order) {
        const remaining = await client.query(
          `SELECT COUNT(*)::int remaining FROM sales_order_items si
           WHERE si.order_id=$1 AND si.ordered_qty >
             (SELECT COALESCE(SUM(CASE WHEN d.status<>'CANCELLED' THEN di.quantity ELSE 0 END),0) FROM dispatch_items di
              JOIN dispatches d ON d.id=di.dispatch_id AND d.status<>'CANCELLED'
              WHERE di.order_item_id=si.id)`,
          [order.id]
        );
        await client.query(
          'UPDATE sales_orders SET status=$1 WHERE id=$2 AND company_id=$3',
          [remaining.rows[0].remaining ? 'PARTIAL' : 'COMPLETED',order.id,req.companyId]
        );
      }
      return dispatch.rows[0];
    },201);
  } catch (error) {
    next(error);
  }
});

router.patch('/dispatches/:id/status', async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(dispatchStatuses) }).parse(req.body);
    await transaction(res,next,async client => {
      const current = await client.query(
        'SELECT id,order_id,status FROM dispatches WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id,req.companyId]
      );
      if (!current.rowCount) {
        const error = new Error('Dispatch not found');
        error.status = 404;
        throw error;
      }
      if (current.rows[0].status === 'DELIVERED' && status !== 'DELIVERED') {
        const error = new Error('Delivered dispatches cannot be reopened or cancelled');
        error.status = 400;
        throw error;
      }
      if (current.rows[0].status === 'CANCELLED' && status !== 'CANCELLED') {
        const error = new Error('Cancelled dispatches cannot be reopened');
        error.status = 400;
        throw error;
      }
      if (status === 'CANCELLED' && current.rows[0].status !== 'CANCELLED') {
        const movements = await client.query(
          `SELECT warehouse_id,product_id,quantity_out,unit_cost FROM stock_movements
           WHERE company_id=$1 AND reference_type='DISPATCH' AND reference_id=$2 AND quantity_out>0`,
          [req.companyId,req.params.id]
        );
        for (const movement of movements.rows) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.companyId}:${movement.warehouse_id}:${movement.product_id}`]);
          await client.query(
            `INSERT INTO stock_movements(company_id,warehouse_id,product_id,movement_date,movement_type,
             reference_type,reference_id,quantity_in,unit_cost)
             VALUES($1,$2,$3,CURRENT_DATE,'RETURN_IN','DISPATCH_CANCEL',$4,$5,$6)`,
            [req.companyId,movement.warehouse_id,movement.product_id,req.params.id,movement.quantity_out,movement.unit_cost]
          );
        }
      }
      const updated = await client.query(
        'UPDATE dispatches SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING *',
        [status,req.params.id,req.companyId]
      );
      if (current.rows[0].order_id && status === 'CANCELLED') {
        const remaining = await client.query(
          `SELECT COUNT(*)::int count FROM sales_order_items si
           WHERE si.order_id=$1 AND si.ordered_qty >
             (SELECT COALESCE(SUM(CASE WHEN d.status<>'CANCELLED' THEN di.quantity ELSE 0 END),0) FROM dispatch_items di
              JOIN dispatches d ON d.id=di.dispatch_id AND d.status<>'CANCELLED'
              WHERE di.order_item_id=si.id)`,
          [current.rows[0].order_id]
        );
        await client.query(
          `UPDATE sales_orders SET status=$1 WHERE id=$2 AND company_id=$3 AND status IN ('PARTIAL','COMPLETED')`,
          [remaining.rows[0].count ? 'APPROVED' : 'COMPLETED',current.rows[0].order_id,req.companyId]
        );
      }
      return updated.rows[0];
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/expenses/:id/status', async (req, res, next) => {
  try {
    const { status } = z.object({ status:z.enum(['PENDING','PAID']) }).parse(req.body);
    const result = await db.query(
      'UPDATE expenses SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING *',
      [status,req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error:'Expense not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/transport/:id/status', async (req, res, next) => {
  try {
    const { payment_status } = z.object({ payment_status:z.enum(['PENDING','PAID']) }).parse(req.body);
    const result = await db.query(
      'UPDATE transport_entries SET payment_status=$1 WHERE id=$2 AND company_id=$3 RETURNING *',
      [payment_status,req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error:'Transport entry not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/purchase-orders', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT po.*,p.name AS supplier_name,
       COALESCE(json_agg(json_build_object('product_id',pi.product_id,'product_name',pr.name,
        'quantity',pi.quantity,'rate',pi.rate,'tax_rate',pi.tax_rate,'line_total',pi.line_total))
        FILTER(WHERE pi.id IS NOT NULL),'[]') AS items
       FROM purchase_orders po JOIN parties p ON p.id=po.supplier_id AND p.company_id=po.company_id
       LEFT JOIN purchase_items pi ON pi.purchase_id=po.id
       LEFT JOIN products pr ON pr.id=pi.product_id AND pr.company_id=po.company_id
       WHERE po.company_id=$1 GROUP BY po.id,p.name ORDER BY po.purchase_date DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/purchase-orders', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      purchase_no: z.string().trim().min(1).max(60),
      supplier_id: z.string().uuid(),
      purchase_date: date,
      items: itemsSchema
    }).parse(req.body);
    await transaction(res,next,async client => {
      await requireParty(client,req.companyId,input.supplier_id,['SUPPLIER']);
      const items = await requireProducts(client,req.companyId,input.items);
      const companyTax = await client.query('SELECT gst_registered FROM companies WHERE id=$1',[req.companyId]);
      if (!companyTax.rows[0].gst_registered) items.forEach(item => { item.tax_rate = 0; });
      const totals = calculateLines(items);
      const order = await client.query(
        `INSERT INTO purchase_orders(company_id,purchase_no,supplier_id,purchase_date,status,grand_total,created_by,id)
         VALUES($1,$2,$3,$4,'DRAFT',$5,$6,COALESCE($7,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.purchase_no,input.supplier_id,input.purchase_date,totals.grandTotal,req.user.sub,input.id || null]
      );
      const lines = await insertLines(client,'purchase_items','purchase_id',order.rows[0].id,totals.lines,'purchase');
      return { ...order.rows[0], items: lines };
    },201);
  } catch (error) {
    next(error);
  }
});

router.put('/purchase-orders/:id', async (req, res, next) => {
  try {
    const input = z.object({
      purchase_no: z.string().trim().min(1).max(60),
      supplier_id: z.string().uuid(),
      purchase_date: date,
      items: itemsSchema
    }).parse(req.body);
    await transaction(res, next, async client => {
      const current = await client.query(
        'SELECT id,status FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id, req.companyId]
      );
      if (!current.rowCount || current.rows[0].status !== 'DRAFT') {
        const error = new Error('Only draft purchase orders can be edited');
        error.status = 409;
        throw error;
      }
      await requireParty(client, req.companyId, input.supplier_id, ['SUPPLIER']);
      const items = await requireProducts(client, req.companyId, input.items);
      const companyTax = await client.query('SELECT gst_registered FROM companies WHERE id=$1', [req.companyId]);
      if (!companyTax.rows[0].gst_registered) items.forEach(item => { item.tax_rate = 0; });
      const totals = calculateLines(items);
      const order = await client.query(
        `UPDATE purchase_orders SET purchase_no=$1,supplier_id=$2,purchase_date=$3,grand_total=$4
         WHERE id=$5 AND company_id=$6 RETURNING *`,
        [input.purchase_no,input.supplier_id,input.purchase_date,totals.grandTotal,req.params.id,req.companyId]
      );
      await client.query('DELETE FROM purchase_items WHERE purchase_id=$1', [req.params.id]);
      const lines = await insertLines(client, 'purchase_items', 'purchase_id', req.params.id, totals.lines, 'purchase');
      return { ...order.rows[0], items: lines };
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/purchase-orders/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM purchase_orders po WHERE po.id=$1 AND po.company_id=$2 AND po.status='DRAFT'
       AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_type='PURCHASE_ORDER' AND sm.reference_id=po.id)
       RETURNING po.id`,
      [req.params.id, req.companyId]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Only unreceived draft purchase orders can be deleted' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (error) {
    next(error);
  }
});

router.post('/purchase-orders/:id/receive', async (req, res, next) => {
  try {
    const { warehouse_id } = z.object({ warehouse_id: z.string().uuid() }).parse(req.body);
    await transaction(res,next,async client => {
      await requireWarehouse(client,req.companyId,warehouse_id);
      const order = await client.query(
        `SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [req.params.id,req.companyId]
      );
      if (!order.rowCount || ['RECEIVED','CANCELLED'].includes(order.rows[0].status)) {
        const error = new Error('Purchase order not found or already closed');
        error.status = 400;
        throw error;
      }
      const items = await client.query(
        `SELECT pi.*,pr.track_inventory FROM purchase_items pi
         JOIN products pr ON pr.id=pi.product_id AND pr.company_id=$2
         WHERE pi.purchase_id=$1`,
        [req.params.id,req.companyId]
      );
      for (const item of items.rows) {
        if (item.track_inventory) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.companyId}:${warehouse_id}:${item.product_id}`]);
          await client.query(
            `INSERT INTO stock_movements(company_id,warehouse_id,product_id,movement_date,movement_type,
             reference_type,reference_id,quantity_in,unit_cost)
             VALUES($1,$2,$3,$4,'PURCHASE','PURCHASE_ORDER',$5,$6,$7)`,
            [req.companyId,warehouse_id,item.product_id,order.rows[0].purchase_date,req.params.id,item.quantity,
              Math.max(0,Number(item.rate)-Number(item.discount || 0)/Number(item.quantity))]
          );
        }
      }
      const updated = await client.query(
        "UPDATE purchase_orders SET status='RECEIVED' WHERE id=$1 AND company_id=$2 RETURNING *",
        [req.params.id,req.companyId]
      );
      return updated.rows[0];
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stock', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pr.id AS product_id,pr.sku,pr.name AS product_name,w.id AS warehouse_id,w.name AS warehouse_name,
       COALESCE(SUM(sm.quantity_in-sm.quantity_out),0) AS quantity
       FROM products pr CROSS JOIN warehouses w
       LEFT JOIN stock_movements sm ON sm.product_id=pr.id AND sm.warehouse_id=w.id AND sm.company_id=pr.company_id
       WHERE pr.company_id=$1 AND w.company_id=$1 AND pr.is_active=TRUE
       GROUP BY pr.id,w.id ORDER BY pr.name,w.name`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/stock/adjustments', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      warehouse_id: z.string().uuid(),
      product_id: z.string().uuid(),
      movement_date: date,
      quantity: z.coerce.number().positive(),
      direction: z.enum(['IN','OUT']),
      unit_cost: z.coerce.number().nonnegative().default(0),
      notes: z.string().max(500).optional()
    }).parse(req.body);
    await transaction(res,next,async client => {
      await requireWarehouse(client,req.companyId,input.warehouse_id);
      const products = await requireProducts(client,req.companyId,[{
        product_id:input.product_id,quantity:input.quantity,rate:input.unit_cost,discount:0
      }]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.companyId}:${input.warehouse_id}:${input.product_id}`]);
      if (input.direction === 'OUT') {
        const current = await client.query(
          'SELECT COALESCE(SUM(quantity_in-quantity_out),0) quantity FROM stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3',
          [req.companyId,input.warehouse_id,input.product_id]
        );
        if (Number(current.rows[0].quantity) < input.quantity) {
          const error = new Error(`Insufficient stock for ${products[0].name}`);
          error.status = 400;
          throw error;
        }
      }
      const movement = await client.query(
        `INSERT INTO stock_movements(company_id,warehouse_id,product_id,movement_date,movement_type,
         reference_type,quantity_in,quantity_out,unit_cost,notes,id)
         VALUES($1,$2,$3,$4,'ADJUSTMENT','MANUAL_ADJUSTMENT',$5,$6,$7,$8,COALESCE($9,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.warehouse_id,input.product_id,input.movement_date,
        input.direction === 'IN' ? input.quantity : 0,input.direction === 'OUT' ? input.quantity : 0,
        input.unit_cost || products[0].purchase_rate || 0,input.notes || null,input.id || null]
      );
      return movement.rows[0];
    },201);
  } catch (error) {
    next(error);
  }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT i.*,p.name AS party_name,COALESCE(pa.allocated,0) AS allocated_amount,
       COALESCE(json_agg(json_build_object('description',ii.description,'quantity',ii.quantity,'rate',ii.rate,
         'tax_rate',ii.tax_rate,'line_total',ii.line_total)) FILTER(WHERE ii.id IS NOT NULL),'[]') AS items
       FROM invoices i JOIN parties p ON p.id=i.party_id AND p.company_id=i.company_id
       LEFT JOIN invoice_items ii ON ii.invoice_id=i.id
       LEFT JOIN (SELECT invoice_id,SUM(amount) allocated FROM payment_allocations GROUP BY invoice_id) pa ON pa.invoice_id=i.id
       WHERE i.company_id=$1 GROUP BY i.id,p.name,pa.allocated ORDER BY i.invoice_date DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/invoices', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      invoice_no: z.string().trim().min(1).max(60),
      invoice_type: z.enum(['SALE','PURCHASE']),
      party_id: z.string().uuid(),
      order_id: z.string().uuid().nullable().optional(),
      invoice_date: date,
      due_date: date.nullable().optional(),
      items: z.array(z.object({
        product_id: z.string().uuid().nullable().optional(),
        description: z.string().trim().min(1).max(240),
        quantity: z.coerce.number().positive(),
        rate: z.coerce.number().nonnegative(),
        tax_rate: z.coerce.number().min(0).max(100).optional()
      })).min(1).max(200)
    }).parse(req.body);
    await transaction(res,next,async client => {
      const accepted = input.invoice_type === 'SALE' ? ['CUSTOMER'] : ['SUPPLIER'];
      await requireParty(client,req.companyId,input.party_id,accepted);
      if (input.order_id) {
        const order = await client.query(
          `SELECT id,status FROM sales_orders WHERE id=$1 AND company_id=$2 AND party_id=$3 FOR UPDATE`,
          [input.order_id,req.companyId,input.party_id]
        );
        if (input.invoice_type !== 'SALE' || !order.rowCount || !['PARTIAL','COMPLETED'].includes(order.rows[0].status)) {
          const error = new Error('Only dispatched sales orders for the selected customer can be invoiced');
          error.status = 400;
          throw error;
        }
      }
      const [companySettings,partySettings] = await Promise.all([
        client.query('SELECT gst_registered,gst_state FROM companies WHERE id=$1',[req.companyId]),
        client.query('SELECT state FROM parties WHERE id=$1 AND company_id=$2',[input.party_id,req.companyId])
      ]);
      const gstEnabled = companySettings.rows[0].gst_registered;
      if (gstEnabled && (!companySettings.rows[0].gst_state || !partySettings.rows[0].state)) {
        const error = new Error('Set the company GST state and the party state before creating a GST invoice');
        error.status = 400;
        throw error;
      }
      const intrastate = Boolean(companySettings.rows[0].gst_state && partySettings.rows[0].state &&
        companySettings.rows[0].gst_state.trim().toLowerCase() === partySettings.rows[0].state.trim().toLowerCase());
      const productIds = input.items.filter(item => item.product_id).map(item => item.product_id);
      const productMap = new Map();
      if (productIds.length) {
        const products = await requireProducts(client,req.companyId,[...new Set(productIds)].map(product_id => ({
          product_id,quantity:1,rate:0,discount:0
        })));
        for (const product of products) productMap.set(product.product_id,product);
      }
      const lines = input.items.map(item => {
        const rate = !gstEnabled ? 0 : item.tax_rate === undefined && item.product_id
          ? Number(productMap.get(item.product_id).tax_rate)
          : item.tax_rate || 0;
        const base = roundMoney(item.quantity * item.rate);
        const total = roundMoney(base + base * rate / 100);
        return { ...item, tax_rate:rate,line_total:total };
      });
      if (input.order_id) {
        if (lines.some(item => !item.product_id)) {
          const error = new Error('Order-linked invoice lines must select a product');
          error.status = 400;
          throw error;
        }
        for (const productId of new Set(lines.map(item => item.product_id))) {
          const invoicedQuantity = lines.filter(item => item.product_id === productId)
            .reduce((sum,item) => sum + item.quantity,0);
          const available = await client.query(
            `SELECT
               COALESCE((SELECT SUM(di.quantity) FROM dispatch_items di
                 JOIN dispatches d ON d.id=di.dispatch_id AND d.company_id=$2 AND d.status<>'CANCELLED'
                 JOIN sales_order_items si ON si.id=di.order_item_id
                 WHERE si.order_id=$1 AND di.product_id=$3),0)
               - COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii
                 JOIN invoices inv ON inv.id=ii.invoice_id
                 WHERE inv.order_id=$1 AND inv.company_id=$2 AND ii.product_id=$3),0) quantity`,
            [input.order_id,req.companyId,productId]
          );
          if (invoicedQuantity > Number(available.rows[0].quantity)) {
            const error = new Error("Invoice quantity cannot exceed this order's dispatched quantity remaining");
            error.status = 400;
            throw error;
          }
        }
      }
      const taxable = roundMoney(lines.reduce((sum,item) => sum + item.quantity * item.rate,0));
      const tax = roundMoney(lines.reduce((sum,item) => sum + item.line_total - item.quantity * item.rate,0));
      const cgst = gstEnabled && intrastate ? roundMoney(tax / 2) : 0;
      const sgst = gstEnabled && intrastate ? roundMoney(tax - cgst) : 0;
      const igst = gstEnabled && !intrastate ? tax : 0;
      const total = roundMoney(taxable + tax);
      const invoice = await client.query(
        `INSERT INTO invoices(company_id,invoice_no,invoice_type,party_id,order_id,invoice_date,due_date,
          taxable_amount,tax_amount,cgst_amount,sgst_amount,igst_amount,grand_total,created_by,id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.invoice_no,input.invoice_type,input.party_id,input.order_id || null,input.invoice_date,input.due_date || null,
          taxable,tax,cgst,sgst,igst,total,req.user.sub,input.id || null]
      );
      const detailLines = lines.map(item => ({ ...item, description:item.description }));
      await insertLines(client,'invoice_items','invoice_id',invoice.rows[0].id,detailLines,'invoice');
      const receivable = ['SALE','DEBIT_NOTE'].includes(input.invoice_type);
      await client.query(
        `INSERT INTO ledger_entries(company_id,party_id,entry_date,voucher_type,voucher_id,narration,debit,credit)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.companyId,input.party_id,input.invoice_date,input.invoice_type,invoice.rows[0].id,
          `Invoice ${input.invoice_no}`,receivable ? total : 0,receivable ? 0 : total]
      );
      return { ...invoice.rows[0], items:detailLines };
    },201);
  } catch (error) {
    next(error);
  }
});

router.get('/payments', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT py.*,p.name AS party_name,
       COALESCE(SUM(pa.amount),0) AS allocated_amount
       FROM payments py JOIN parties p ON p.id=py.party_id AND p.company_id=py.company_id
       LEFT JOIN payment_allocations pa ON pa.payment_id=py.id
       WHERE py.company_id=$1 GROUP BY py.id,p.name ORDER BY py.payment_date DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/payments', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      payment_no: z.string().trim().min(1).max(60),
      party_id: z.string().uuid(),
      payment_date: date,
      payment_type: z.enum(['RECEIPT','PAYMENT']),
      mode: z.enum(paymentModes),
      amount: z.coerce.number().positive(),
      reference_no: z.string().max(100).nullable().optional(),
      notes: z.string().max(10000).nullable().optional(),
      allocations: z.array(z.object({ invoice_id:z.string().uuid(), amount:z.coerce.number().positive() })).max(200).default([])
    }).parse(req.body);
    const allocated = roundMoney(input.allocations.reduce((sum,item) => sum + item.amount,0));
    if (allocated > input.amount) return res.status(400).json({ error: 'Allocated amount cannot exceed payment amount' });
    await transaction(res,next,async client => {
      await requireParty(client,req.companyId,input.party_id,input.payment_type === 'RECEIPT' ? ['CUSTOMER'] : ['SUPPLIER']);
      const payment = await client.query(
        `INSERT INTO payments(company_id,payment_no,party_id,payment_date,payment_type,mode,amount,reference_no,notes,created_by,id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.payment_no,input.party_id,input.payment_date,input.payment_type,input.mode,input.amount,
          input.reference_no || null,input.notes || null,req.user.sub,input.id || null]
      );
      for (const allocation of input.allocations) {
        const invoice = await client.query(
          `SELECT id,invoice_type,grand_total FROM invoices
           WHERE id=$1 AND company_id=$2 AND party_id=$3 FOR UPDATE`,
          [allocation.invoice_id,req.companyId,input.party_id]
        );
        const expectedType = input.payment_type === 'RECEIPT' ? 'SALE' : 'PURCHASE';
        if (!invoice.rowCount || invoice.rows[0].invoice_type !== expectedType) {
          const error = new Error('Payment can only be allocated to an invoice for the selected party');
          error.status = 400;
          throw error;
        }
        const already = await client.query(
          'SELECT COALESCE(SUM(amount),0) amount FROM payment_allocations WHERE invoice_id=$1',
          [allocation.invoice_id]
        );
        if (Number(already.rows[0].amount) + allocation.amount > Number(invoice.rows[0].grand_total)) {
          const error = new Error('Allocation exceeds the invoice balance');
          error.status = 400;
          throw error;
        }
        await client.query(
          'INSERT INTO payment_allocations(payment_id,invoice_id,amount) VALUES($1,$2,$3)',
          [payment.rows[0].id,allocation.invoice_id,allocation.amount]
        );
        const balance = Number(invoice.rows[0].grand_total) - Number(already.rows[0].amount) - allocation.amount;
        await client.query(
          'UPDATE invoices SET status=$1 WHERE id=$2 AND company_id=$3',
          [balance <= 0 ? 'PAID' : 'PARTIAL',allocation.invoice_id,req.companyId]
        );
      }
      const isReceipt = input.payment_type === 'RECEIPT';
      await client.query(
        `INSERT INTO ledger_entries(company_id,party_id,entry_date,voucher_type,voucher_id,narration,debit,credit)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.companyId,input.party_id,input.payment_date,input.payment_type,payment.rows[0].id,
          `${input.payment_type} ${input.payment_no}`,isReceipt ? 0 : input.amount,isReceipt ? input.amount : 0]
      );
      return { ...payment.rows[0], allocated_amount:allocated };
    },201);
  } catch (error) {
    next(error);
  }
});

router.get('/expenses', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT e.*,ec.name AS category_name FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id=e.category_id AND ec.company_id=e.company_id
       WHERE e.company_id=$1 ORDER BY e.expense_date DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      expense_no:z.string().trim().min(1).max(60),
      category:z.string().trim().min(1).max(100),
      expense_date:date,
      amount:z.coerce.number().positive(),
      paid_to:z.string().max(160).nullable().optional(),
      payment_mode:z.enum(paymentModes).nullable().optional(),
      notes:z.string().max(10000).nullable().optional(),
      status:z.enum(['PENDING','PAID']).default('PENDING')
    }).parse(req.body);
    await transaction(res,next,async client => {
      const category = await client.query(
        `INSERT INTO expense_categories(company_id,name) VALUES($1,$2)
         ON CONFLICT(company_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [req.companyId,input.category]
      );
      const expense = await client.query(
        `INSERT INTO expenses(company_id,expense_no,category_id,expense_date,amount,paid_to,payment_mode,notes,status,created_by,id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.expense_no,category.rows[0].id,input.expense_date,input.amount,input.paid_to || null,
          input.payment_mode || null,input.notes || null,input.status,req.user.sub,input.id || null]
      );
      return expense.rows[0];
    },201);
  } catch (error) {
    next(error);
  }
});

router.put('/expenses/:id', async (req, res, next) => {
  try {
    const input = z.object({
      expense_no:z.string().trim().min(1).max(60),
      category:z.string().trim().min(1).max(100),
      expense_date:date,
      amount:z.coerce.number().positive(),
      paid_to:z.string().max(160).nullable().optional(),
      payment_mode:z.enum(paymentModes).nullable().optional(),
      notes:z.string().max(10000).nullable().optional()
    }).parse(req.body);
    await transaction(res, next, async client => {
      const current = await client.query(
        'SELECT id,status FROM expenses WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id,req.companyId]
      );
      if (!current.rowCount || current.rows[0].status !== 'PENDING') {
        const error = new Error('Only pending expenses can be edited');
        error.status = 409;
        throw error;
      }
      const category = await client.query(
        `INSERT INTO expense_categories(company_id,name) VALUES($1,$2)
         ON CONFLICT(company_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [req.companyId,input.category]
      );
      const result = await client.query(
        `UPDATE expenses SET expense_no=$1,category_id=$2,expense_date=$3,amount=$4,paid_to=$5,
         payment_mode=$6,notes=$7 WHERE id=$8 AND company_id=$9 RETURNING *`,
        [input.expense_no,category.rows[0].id,input.expense_date,input.amount,input.paid_to || null,
          input.payment_mode || null,input.notes || null,req.params.id,req.companyId]
      );
      return result.rows[0];
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      "DELETE FROM expenses WHERE id=$1 AND company_id=$2 AND status='PENDING' RETURNING id",
      [req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Only pending expenses can be deleted' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (error) {
    next(error);
  }
});

router.get('/transport', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.*,d.dispatch_no FROM transport_entries t
       LEFT JOIN dispatches d ON d.id=t.dispatch_id AND d.company_id=t.company_id
       WHERE t.company_id=$1 ORDER BY t.entry_date DESC LIMIT 500`,
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/transport', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      dispatch_id:z.string().uuid().nullable().optional(),
      transporter_name:z.string().max(160).nullable().optional(),
      vehicle_no:z.string().max(30).nullable().optional(),
      driver_name:z.string().max(120).nullable().optional(),
      lr_no:z.string().max(80).nullable().optional(),
      freight:z.coerce.number().nonnegative().default(0),
      loading_charges:z.coerce.number().nonnegative().default(0),
      unloading_charges:z.coerce.number().nonnegative().default(0),
      payment_status:z.enum(['PENDING','PAID']).default('PENDING'),
      entry_date:date
    }).parse(req.body);
    await transaction(res,next,async client => {
      if (input.dispatch_id) {
        const dispatch = await client.query(
          'SELECT id FROM dispatches WHERE id=$1 AND company_id=$2',
          [input.dispatch_id,req.companyId]
        );
        if (!dispatch.rowCount) {
          const error = new Error('Dispatch not found for this company');
          error.status = 400;
          throw error;
        }
      }
      const result = await client.query(
        `INSERT INTO transport_entries(company_id,dispatch_id,transporter_name,vehicle_no,driver_name,lr_no,
          freight,loading_charges,unloading_charges,payment_status,entry_date,id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,gen_random_uuid())) RETURNING *`,
        [req.companyId,input.dispatch_id || null,input.transporter_name || null,input.vehicle_no || null,
          input.driver_name || null,input.lr_no || null,input.freight,input.loading_charges,input.unloading_charges,
          input.payment_status,input.entry_date,input.id || null]
      );
      return result.rows[0];
    },201);
  } catch (error) {
    next(error);
  }
});

router.put('/transport/:id', async (req, res, next) => {
  try {
    const input = z.object({
      dispatch_id:z.string().uuid().nullable().optional(),
      transporter_name:z.string().max(160).nullable().optional(),
      vehicle_no:z.string().max(30).nullable().optional(),
      driver_name:z.string().max(120).nullable().optional(),
      lr_no:z.string().max(80).nullable().optional(),
      freight:z.coerce.number().nonnegative().default(0),
      loading_charges:z.coerce.number().nonnegative().default(0),
      unloading_charges:z.coerce.number().nonnegative().default(0),
      entry_date:date
    }).parse(req.body);
    await transaction(res, next, async client => {
      const current = await client.query(
        'SELECT id,payment_status FROM transport_entries WHERE id=$1 AND company_id=$2 FOR UPDATE',
        [req.params.id,req.companyId]
      );
      if (!current.rowCount || current.rows[0].payment_status !== 'PENDING') {
        const error = new Error('Only pending transport entries can be edited');
        error.status = 409;
        throw error;
      }
      if (input.dispatch_id) {
        const dispatch = await client.query(
          'SELECT id FROM dispatches WHERE id=$1 AND company_id=$2',
          [input.dispatch_id,req.companyId]
        );
        if (!dispatch.rowCount) {
          const error = new Error('Dispatch not found for this company');
          error.status = 400;
          throw error;
        }
      }
      const result = await client.query(
        `UPDATE transport_entries SET dispatch_id=$1,transporter_name=$2,vehicle_no=$3,driver_name=$4,
         lr_no=$5,freight=$6,loading_charges=$7,unloading_charges=$8,entry_date=$9
         WHERE id=$10 AND company_id=$11 RETURNING *`,
        [input.dispatch_id || null,input.transporter_name || null,input.vehicle_no || null,input.driver_name || null,
          input.lr_no || null,input.freight,input.loading_charges,input.unloading_charges,input.entry_date,
          req.params.id,req.companyId]
      );
      return result.rows[0];
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/transport/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      "DELETE FROM transport_entries WHERE id=$1 AND company_id=$2 AND payment_status='PENDING' RETURNING id",
      [req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Only pending transport entries can be deleted' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (error) {
    next(error);
  }
});

router.get('/ledger', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT le.*,p.name AS party_name FROM ledger_entries le
       LEFT JOIN parties p ON p.id=le.party_id AND p.company_id=le.company_id
       WHERE le.company_id=$1 AND ($2::uuid IS NULL OR le.party_id=$2)
       ORDER BY le.entry_date DESC,le.created_at DESC LIMIT 1000`,
      [req.companyId,req.query.partyId || null]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/team', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id,employee_code,full_name,designation,department,phone,email,is_active FROM employees WHERE company_id=$1 ORDER BY full_name LIMIT 500',
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/team', async (req, res, next) => {
  try {
    const input = z.object({
      id: optionalId,
      employee_code:z.string().max(50).nullable().optional(),
      full_name:z.string().trim().min(1).max(160),
      designation:z.string().max(100).nullable().optional(),
      department:z.string().max(100).nullable().optional(),
      phone:z.string().max(30).nullable().optional(),
      email:z.string().email().max(180).nullable().optional()
    }).parse(req.body);
    const result = await db.query(
      `INSERT INTO employees(company_id,employee_code,full_name,designation,department,phone,email,id)
       VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,gen_random_uuid())) RETURNING *`,
      [req.companyId,input.employee_code || null,input.full_name,input.designation || null,input.department || null,
        input.phone || null,input.email || null,input.id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/team/:id', async (req, res, next) => {
  try {
    const input = z.object({
      employee_code:z.string().max(50).nullable().optional(),
      full_name:z.string().trim().min(1).max(160),
      designation:z.string().max(100).nullable().optional(),
      department:z.string().max(100).nullable().optional(),
      phone:z.string().max(30).nullable().optional(),
      email:z.string().trim().email().max(180).nullable().optional()
    }).parse(req.body);
    const result = await db.query(
      `UPDATE employees SET employee_code=$1,full_name=$2,designation=$3,department=$4,phone=$5,email=$6
       WHERE id=$7 AND company_id=$8 AND is_active=TRUE RETURNING *`,
      [input.employee_code || null,input.full_name,input.designation || null,input.department || null,
        input.phone || null,input.email || null,req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Active team member not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/team/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      'UPDATE employees SET is_active=FALSE WHERE id=$1 AND company_id=$2 AND is_active=TRUE RETURNING id',
      [req.params.id,req.companyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Active team member not found' });
    res.json({ id: result.rows[0].id, archived: true });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/summary', async (req, res, next) => {
  try {
    const [sales, purchases, receivables, payables, stock] = await Promise.all([
      db.query(
        "SELECT COALESCE(SUM(grand_total),0) total,COUNT(*)::int count FROM invoices WHERE company_id=$1 AND invoice_type='SALE'",
        [req.companyId]
      ),
      db.query(
        "SELECT COALESCE(SUM(grand_total),0) total,COUNT(*)::int count FROM invoices WHERE company_id=$1 AND invoice_type='PURCHASE'",
        [req.companyId]
      ),
      db.query(
        `SELECT COALESCE(SUM(i.grand_total-COALESCE(a.amount,0)),0) amount
         FROM invoices i LEFT JOIN (
           SELECT pa.invoice_id,SUM(pa.amount) amount FROM payment_allocations pa GROUP BY pa.invoice_id
         ) a ON a.invoice_id=i.id
         WHERE i.company_id=$1 AND i.invoice_type='SALE'`,
        [req.companyId]
      ),
      db.query(
        `SELECT COALESCE(SUM(i.grand_total-COALESCE(a.amount,0)),0) amount
         FROM invoices i LEFT JOIN (
           SELECT pa.invoice_id,SUM(pa.amount) amount FROM payment_allocations pa GROUP BY pa.invoice_id
         ) a ON a.invoice_id=i.id
         WHERE i.company_id=$1 AND i.invoice_type='PURCHASE'`,
        [req.companyId]
      ),
      db.query(
        `SELECT COALESCE(SUM(q.quantity*COALESCE(c.average_cost,0)),0) value
         FROM (
           SELECT company_id,warehouse_id,product_id,SUM(quantity_in-quantity_out) quantity
           FROM stock_movements WHERE company_id=$1 GROUP BY company_id,warehouse_id,product_id
         ) q LEFT JOIN (
           SELECT company_id,warehouse_id,product_id,
             SUM(quantity_in*unit_cost)/NULLIF(SUM(quantity_in),0) average_cost
           FROM stock_movements WHERE company_id=$1 AND quantity_in>0
           GROUP BY company_id,warehouse_id,product_id
         ) c ON c.company_id=q.company_id AND c.warehouse_id=q.warehouse_id AND c.product_id=q.product_id`,
        [req.companyId]
      )
    ]);
    res.json({
      sales: { count:sales.rows[0].count,total:Number(sales.rows[0].total) },
      purchases: { count:purchases.rows[0].count,total:Number(purchases.rows[0].total) },
      receivables:Number(receivables.rows[0].amount),
      payables:Number(payables.rows[0].amount),
      stockValue:Number(stock.rows[0].value)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
