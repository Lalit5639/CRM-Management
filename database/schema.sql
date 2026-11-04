CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(180) NOT NULL,
  legal_name VARCHAR(220), gstin VARCHAR(15), email VARCHAR(180), phone VARCHAR(30),
  address TEXT, gst_registered BOOLEAN NOT NULL DEFAULT TRUE,
  gst_state VARCHAR(100), currency CHAR(3) NOT NULL DEFAULT 'INR', is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gst_state VARCHAR(100);
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(120) NOT NULL, code VARCHAR(30), address TEXT, is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(company_id, code)
);
CREATE TABLE IF NOT EXISTS financial_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  label VARCHAR(20) NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, is_current BOOLEAN DEFAULT FALSE,
  UNIQUE(company_id, label), CHECK(ends_on >= starts_on)
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name VARCHAR(160) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES companies(id),
  name VARCHAR(80) NOT NULL, description TEXT, UNIQUE(company_id, name)
);
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(120) NOT NULL UNIQUE, description TEXT
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE, permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS user_companies (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id), branch_id UUID REFERENCES branches(id), is_default BOOLEAN DEFAULT FALSE,
  PRIMARY KEY(user_id, company_id)
);
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  party_code VARCHAR(50), name VARCHAR(180) NOT NULL, party_type VARCHAR(20) NOT NULL CHECK(party_type IN ('CUSTOMER','SUPPLIER','BOTH')),
  gstin VARCHAR(15), pan VARCHAR(10), phone VARCHAR(30), email VARCHAR(180), billing_address TEXT,
  shipping_address TEXT, state VARCHAR(100), credit_limit NUMERIC(16,2) DEFAULT 0,
  opening_balance NUMERIC(16,2) DEFAULT 0, opening_balance_type VARCHAR(2) CHECK(opening_balance_type IN ('DR','CR')),
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(company_id, party_code)
);
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  sku VARCHAR(80), name VARCHAR(180) NOT NULL, category VARCHAR(100), hsn_code VARCHAR(20),
  unit VARCHAR(20) NOT NULL DEFAULT 'BAG', pack_size NUMERIC(12,3), sale_rate NUMERIC(16,2) DEFAULT 0,
  purchase_rate NUMERIC(16,2) DEFAULT 0, gst_rate NUMERIC(5,2) DEFAULT 0,
  track_inventory BOOLEAN DEFAULT TRUE, is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(company_id, sku)
);
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  employee_code VARCHAR(50), full_name VARCHAR(160) NOT NULL, designation VARCHAR(100), department VARCHAR(100),
  phone VARCHAR(30), email VARCHAR(180), manager_id UUID REFERENCES employees(id), is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(company_id, employee_code)
);
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  order_no VARCHAR(60) NOT NULL, party_id UUID NOT NULL REFERENCES parties(id), order_date DATE NOT NULL,
  salesperson_id UUID REFERENCES employees(id), status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','PARTIAL','COMPLETED','CANCELLED')),
  subtotal NUMERIC(16,2) NOT NULL DEFAULT 0, discount_total NUMERIC(16,2) DEFAULT 0,
  tax_total NUMERIC(16,2) DEFAULT 0, grand_total NUMERIC(16,2) NOT NULL DEFAULT 0,
  notes TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, order_no)
);
CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id), ordered_qty NUMERIC(16,3) NOT NULL CHECK(ordered_qty > 0),
  rate NUMERIC(16,2) NOT NULL CHECK(rate >= 0), discount NUMERIC(16,2) DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0, line_total NUMERIC(16,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  dispatch_no VARCHAR(60) NOT NULL, order_id UUID REFERENCES sales_orders(id), party_id UUID NOT NULL REFERENCES parties(id),
  dispatch_date DATE NOT NULL, vehicle_no VARCHAR(30), driver_name VARCHAR(120), driver_phone VARCHAR(30),
  transporter_name VARCHAR(160), lr_no VARCHAR(80), eway_bill_no VARCHAR(80), freight NUMERIC(16,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'DISPATCHED' CHECK(status IN ('DISPATCHED','IN_TRANSIT','DELIVERED','CANCELLED')),
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(company_id, dispatch_no)
);
CREATE TABLE IF NOT EXISTS dispatch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES sales_order_items(id), product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(16,3) NOT NULL CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  purchase_no VARCHAR(60) NOT NULL, supplier_id UUID NOT NULL REFERENCES parties(id), purchase_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'DRAFT', grand_total NUMERIC(16,2) DEFAULT 0, created_by UUID REFERENCES users(id),
  UNIQUE(company_id, purchase_no)
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id), quantity NUMERIC(16,3) NOT NULL CHECK(quantity > 0),
  rate NUMERIC(16,2) NOT NULL, discount NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0, line_total NUMERIC(16,2) NOT NULL
);
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS discount NUMERIC(16,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(120) NOT NULL, branch_id UUID REFERENCES branches(id), UNIQUE(company_id, name)
);
INSERT INTO warehouses(company_id,name)
SELECT c.id,'Main Warehouse' FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=c.id);
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), product_id UUID NOT NULL REFERENCES products(id),
  movement_date DATE NOT NULL, movement_type VARCHAR(20) NOT NULL CHECK(movement_type IN ('OPENING','PURCHASE','SALE','RETURN_IN','RETURN_OUT','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
  reference_type VARCHAR(40), reference_id UUID, quantity_in NUMERIC(16,3) DEFAULT 0,
  quantity_out NUMERIC(16,3) DEFAULT 0, unit_cost NUMERIC(16,2) DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK(quantity_in >= 0 AND quantity_out >= 0)
);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  invoice_no VARCHAR(60) NOT NULL, invoice_type VARCHAR(12) NOT NULL CHECK(invoice_type IN ('SALE','PURCHASE','CREDIT_NOTE','DEBIT_NOTE')),
  party_id UUID NOT NULL REFERENCES parties(id), order_id UUID REFERENCES sales_orders(id), invoice_date DATE NOT NULL,
  due_date DATE, taxable_amount NUMERIC(16,2) DEFAULT 0, tax_amount NUMERIC(16,2) DEFAULT 0,
  cgst_amount NUMERIC(16,2) NOT NULL DEFAULT 0, sgst_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(16,2) NOT NULL, status VARCHAR(20) DEFAULT 'UNPAID', created_by UUID REFERENCES users(id),
  UNIQUE(company_id, invoice_no)
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(16,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(16,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(16,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  description VARCHAR(240) NOT NULL,
  quantity NUMERIC(16,3) NOT NULL CHECK(quantity > 0),
  rate NUMERIC(16,2) NOT NULL CHECK(rate >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
  line_total NUMERIC(16,2) NOT NULL CHECK(line_total >= 0)
);
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  payment_no VARCHAR(60) NOT NULL, party_id UUID NOT NULL REFERENCES parties(id), payment_date DATE NOT NULL,
  payment_type VARCHAR(12) NOT NULL CHECK(payment_type IN ('RECEIPT','PAYMENT')),
  mode VARCHAR(20) NOT NULL CHECK(mode IN ('CASH','BANK','UPI','CHEQUE','NEFT','RTGS','OTHER')),
  amount NUMERIC(16,2) NOT NULL CHECK(amount > 0), reference_no VARCHAR(100), notes TEXT,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(company_id, payment_no)
);
CREATE TABLE IF NOT EXISTS payment_allocations (
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE, invoice_id UUID REFERENCES invoices(id),
  amount NUMERIC(16,2) NOT NULL CHECK(amount > 0), PRIMARY KEY(payment_id, invoice_id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  party_id UUID REFERENCES parties(id), entry_date DATE NOT NULL, voucher_type VARCHAR(30) NOT NULL,
  voucher_id UUID, narration TEXT, debit NUMERIC(16,2) DEFAULT 0, credit NUMERIC(16,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), CHECK(debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(100) NOT NULL, UNIQUE(company_id, name)
);
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  expense_no VARCHAR(60) NOT NULL, category_id UUID REFERENCES expense_categories(id), expense_date DATE NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK(amount > 0), paid_to VARCHAR(160), payment_mode VARCHAR(20), notes TEXT,
  status VARCHAR(20) DEFAULT 'PENDING', created_by UUID REFERENCES users(id), UNIQUE(company_id, expense_no)
);
CREATE TABLE IF NOT EXISTS transport_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  dispatch_id UUID REFERENCES dispatches(id), transporter_name VARCHAR(160), vehicle_no VARCHAR(30),
  driver_name VARCHAR(120), lr_no VARCHAR(80), freight NUMERIC(16,2) DEFAULT 0,
  loading_charges NUMERIC(16,2) DEFAULT 0, unloading_charges NUMERIC(16,2) DEFAULT 0,
  payment_status VARCHAR(20) DEFAULT 'PENDING', entry_date DATE NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(100) NOT NULL, slug VARCHAR(100) NOT NULL, description TEXT, icon VARCHAR(60),
  is_active BOOLEAN DEFAULT TRUE, created_by UUID REFERENCES users(id), UNIQUE(company_id, slug)
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), module_id UUID NOT NULL REFERENCES custom_modules(id) ON DELETE CASCADE,
  field_key VARCHAR(80) NOT NULL, label VARCHAR(120) NOT NULL,
  field_type VARCHAR(20) NOT NULL CHECK(field_type IN ('text','number','date','select','checkbox','textarea','email','phone')),
  is_required BOOLEAN DEFAULT FALSE, options JSONB DEFAULT '[]', sort_order INTEGER DEFAULT 0,
  UNIQUE(module_id, field_key)
);
CREATE TABLE IF NOT EXISTS custom_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  module_id UUID NOT NULL REFERENCES custom_modules(id) ON DELETE CASCADE, data JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES companies(id), user_id UUID REFERENCES users(id),
  action VARCHAR(40) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id UUID,
  old_data JSONB, new_data JSONB, ip_address INET, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID REFERENCES users(id), title VARCHAR(180) NOT NULL, message TEXT, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  company_name VARCHAR(180),
  email VARCHAR(180),
  phone VARCHAR(30),
  source VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK(status IN ('NEW','CONTACTED','QUALIFIED','CONVERTED','LOST')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, company_id)
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  company_name VARCHAR(180),
  email VARCHAR(180),
  phone VARCHAR(30),
  job_title VARCHAR(120),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, company_id)
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(amount >= 0),
  stage VARCHAR(20) NOT NULL DEFAULT 'QUALIFICATION'
    CHECK(stage IN ('QUALIFICATION','PROPOSAL','NEGOTIATION','WON','LOST')),
  expected_close_date DATE,
  contact_id UUID,
  lead_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, company_id),
  FOREIGN KEY(contact_id, company_id) REFERENCES crm_contacts(id, company_id),
  FOREIGN KEY(lead_id, company_id) REFERENCES crm_leads(id, company_id)
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject VARCHAR(180) NOT NULL,
  activity_type VARCHAR(20) NOT NULL DEFAULT 'TASK'
    CHECK(activity_type IN ('CALL','EMAIL','MEETING','TASK')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','COMPLETED')),
  due_at TIMESTAMPTZ,
  description TEXT,
  lead_id UUID,
  contact_id UUID,
  deal_id UUID,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(lead_id, company_id) REFERENCES crm_leads(id, company_id),
  FOREIGN KEY(contact_id, company_id) REFERENCES crm_contacts(id, company_id),
  FOREIGN KEY(deal_id, company_id) REFERENCES crm_deals(id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_parties_company_name ON parties(company_id, name);
CREATE INDEX IF NOT EXISTS idx_products_company_name ON products(company_id, name);
CREATE INDEX IF NOT EXISTS idx_orders_company_date ON sales_orders(company_id, order_date);
CREATE INDEX IF NOT EXISTS idx_dispatch_company_date ON dispatches(company_id, dispatch_date);
CREATE INDEX IF NOT EXISTS idx_payments_company_date ON payments(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_ledger_company_party_date ON ledger_entries(company_id, party_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_stock_company_product ON stock_movements(company_id, product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_custom_records_module ON custom_records(company_id, module_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_company_status ON crm_leads(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_company_name ON crm_contacts(company_id, name);
CREATE INDEX IF NOT EXISTS idx_crm_deals_company_stage ON crm_deals(company_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_company_due ON crm_activities(company_id, status, due_at);
