# Phoenix Business Suite

A Node.js, Express, PostgreSQL, and HTML/CSS/JavaScript multi-company CRM and trading ERP MVP.

## Working sections
- Company signup, owner login, company profile and GST state settings
- CRM leads, contacts, deals/pipeline, activities and tasks
- Customer/supplier parties, products, sales team directory and custom sections
- Sales orders with product lines, discounts and GST rates
- Order submission/approval, dispatch, warehouse stock deduction and dispatch cancellation reversal
- Purchase orders, warehouse receiving and stock movements
- Sales and purchase invoices, intra-state CGST/SGST and inter-state IGST totals
- Receipts/payments with optional invoice allocation and party subledger postings
- Expenses, transport entries, warehouse stock adjustments and inventory balance
- Sales/purchase, receivables/payables, stock-value and CRM dashboard summaries
- Click or tap a listed record to view its full details; print views can be saved as PDFs from the browser
- New business records accept a manually entered UUID as their record ID; company, login, and system-generated IDs remain automatic
- Edit/delete CRM and custom entries, archive masters/team members, and edit eligible drafts; invoices, payments, dispatches, stock movements, and ledger entries are protected
- Warehouses can be renamed; deletion is blocked when stock history exists or it is the company’s last warehouse

## Requirements and setup
- Node.js 20+
- PostgreSQL 14+

1. Create a PostgreSQL database named `phoenix_business_suite`.
2. Copy `.env.example` to `.env`; set `DATABASE_URL` and a long random `JWT_SECRET`.
3. Install dependencies with `npm install`.
4. Apply the schema with `npm run db:migrate`.
5. Start with `npm run dev`, then open `http://localhost:3000`.
6. Select **Create a company account**. Signup creates the company, owner, Owner role, membership, and Main Warehouse atomically.
7. In **Settings & Users**, set the company's legal name, GSTIN, GST state, registered status, contact information, and address before issuing GST invoices.

Passwords need at least 12 characters with uppercase, lowercase, and a number. GST invoices require both the company's GST state and the party state; same-state supplies split GST equally into CGST/SGST, and other-state supplies use IGST. Product GST percentages are used as line defaults and can be overridden on entries.

## Main API groups
- `/api/auth` — company signup and login
- `/api/crm` — leads, contacts, deals, activities, and summary
- `/api/masters` — parties and products
- `/api/operations` — sales orders, dispatches, purchase orders/receipt, warehouses, stock, invoices, payments, expenses, transport, party ledger, team directory, reports, and company settings
- `/api/custom` — custom modules, fields, and records

All authenticated business records are scoped to the selected company (`X-Company-Id`). Transactional writes use PostgreSQL transactions. Stock receipt/dispatch and payment allocation lock their parent records or inventory keys to prevent duplicate receiving, over-dispatch, negative stock, and over-allocation.

## Remaining production work
This is not yet a production accounting/ERP system. There is no employee invitation/password-reset workflow, role permission enforcement, quote/PDF generation, e-invoicing, e-way bill integration, GST return filing, GST rounding/legal validation, credit-note/debit-note workflow, stock transfers, returns, audit event coverage, backups, or full double-entry chart of accounts. The party ledger currently reflects invoices and receipts/payments, not a complete general ledger. Verify tax/accounting rules with a qualified professional before using generated totals for statutory filings. Keep PostgreSQL backups and never expose database credentials or JWT secrets in frontend code.
