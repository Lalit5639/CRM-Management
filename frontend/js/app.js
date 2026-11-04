const $ = selector => document.querySelector(selector);
let session = { token: null, user: null, companies: [], companyId: null };
let authMode = 'login';

function manualIdField(id) {
  return `<div class="col-md-6"><label class="form-label" for="${id}">Record ID (UUID) *</label><input class="form-control" id="${id}" name="id" type="text" required minlength="36" maxlength="36" pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" title="Enter a valid UUID"></div>`;
}

$('#today').textContent = new Date().toLocaleDateString('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

const quickModules = [
  ['Leads', 'Capture and qualify new business', '♙', 'leads'],
  ['Contacts', 'Keep customer contacts organized', '♧', 'contacts'],
  ['Deals Pipeline', 'Track opportunities and revenue', '◇', 'deals'],
  ['Activities & Tasks', 'Plan calls, meetings, and follow-ups', '✓', 'activities'],
  ['Sales Orders', 'Prepare customer quotations and orders', '▤', 'orders'],
  ['Dispatches', 'Ship approved orders and update stock', '⇧', 'dispatch'],
  ['Purchase Orders', 'Order supplier stock', '＋', 'purchase'],
  ['Stock', 'View stock and adjust warehouse quantities', '▥', 'stock'],
  ['Invoices', 'Create sales and purchase invoices', '▧', 'invoices'],
  ['Receipts & Payments', 'Record customer and supplier payments', '₹', 'payments'],
  ['Expenses', 'Record and track business expenses', '↗', 'expenses'],
  ['Party Master', 'Customer and supplier directory', '♙', 'parties'],
  ['Product Master', 'SKU, HSN, GST and rates', '◇', 'products'],
  ['Party Ledger', 'View posted party balances and vouchers', '≋', 'ledger'],
  ['Transport', 'Track freight and transport charges', '▣', 'transport'],
  ['Sales Team', 'Maintain your sales employee directory', '♧', 'team'],
  ['Reports', 'Review company sales and stock totals', '▥', 'reports'],
  ['Company Settings', 'Edit GST and company profile settings', '⚙', 'settings'],
  ['Custom Sections', 'Build company-specific modules', '▦', 'custom']
];

const crmViews = {
  leads: {
    title: 'Leads',
    singular: 'Lead',
    endpoint: '/crm/leads',
    columns: [['name', 'Name'], ['company_name', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['source', 'Source']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'source', label: 'Lead source', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  contacts: {
    title: 'Contacts',
    singular: 'Contact',
    endpoint: '/crm/contacts',
    columns: [['name', 'Name'], ['company_name', 'Company'], ['job_title', 'Job title'], ['email', 'Email'], ['phone', 'Phone']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'job_title', label: 'Job title', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  deals: {
    title: 'Deals Pipeline',
    singular: 'Deal',
    endpoint: '/crm/deals',
    columns: [['name', 'Deal'], ['amount', 'Amount'], ['expected_close_date', 'Expected close'], ['contact_name', 'Contact'], ['lead_name', 'Lead']],
    fields: [
      { key: 'name', label: 'Deal name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', min: '0' },
      { key: 'stage', label: 'Stage', type: 'select', options: ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
      { key: 'expected_close_date', label: 'Expected close date', type: 'date' },
      { key: 'contact_id', label: 'Contact', type: 'relation', endpoint: '/crm/contacts', emptyLabel: 'No contact' },
      { key: 'lead_id', label: 'Lead', type: 'relation', endpoint: '/crm/leads', emptyLabel: 'No lead' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  activities: {
    title: 'Activities & Tasks',
    singular: 'Activity',
    endpoint: '/crm/activities',
    columns: [['subject', 'Subject'], ['activity_type', 'Type'], ['due_at', 'Due'], ['description', 'Details']],
    fields: [
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'activity_type', label: 'Type', type: 'select', options: ['TASK', 'CALL', 'EMAIL', 'MEETING'] },
      { key: 'due_at', label: 'Due date and time', type: 'datetime-local' },
      { key: 'lead_id', label: 'Related lead', type: 'relation', endpoint: '/crm/leads', emptyLabel: 'No lead' },
      { key: 'contact_id', label: 'Related contact', type: 'relation', endpoint: '/crm/contacts', emptyLabel: 'No contact' },
      { key: 'deal_id', label: 'Related deal', type: 'relation', endpoint: '/crm/deals', emptyLabel: 'No deal' },
      { key: 'description', label: 'Details', type: 'textarea' }
    ]
  }
};

const operationViews = {
  orders: {
    title: 'Sales Orders', endpoint: '/operations/sales-orders',
    columns: [['order_no','Order #'],['party_name','Customer'],['order_date','Date'],['grand_total','Total'],['status','Status']],
    fields: [
      { key:'order_no',label:'Order number',type:'text',required:true },
      { key:'party_id',label:'Customer',type:'relation',endpoint:'/masters/parties',filter:'customer',required:true },
      { key:'order_date',label:'Order date',type:'date',required:true,today:true },
      { key:'items',label:'Order lines',type:'items' },
      { key:'notes',label:'Notes',type:'textarea' }
    ]
  },
  dispatch: {
    title: 'Dispatches', endpoint: '/operations/dispatches',
    columns: [['dispatch_no','Dispatch #'],['order_no','Order #'],['party_name','Customer'],['dispatch_date','Date'],['vehicle_no','Vehicle'],['status','Status']],
    fields: [
      { key:'dispatch_no',label:'Dispatch number',type:'text',required:true },
      { key:'order_id',label:'Approved order (optional)',type:'relation',endpoint:'/operations/sales-orders',filter:'approved',emptyLabel:'No linked order' },
      { key:'party_id',label:'Customer',type:'relation',endpoint:'/masters/parties',filter:'customer',required:true },
      { key:'warehouse_id',label:'Warehouse',type:'relation',endpoint:'/operations/warehouses',required:true },
      { key:'dispatch_date',label:'Dispatch date',type:'date',required:true,today:true },
      { key:'vehicle_no',label:'Vehicle number',type:'text' },
      { key:'driver_name',label:'Driver name',type:'text' },
      { key:'transporter_name',label:'Transporter',type:'text' },
      { key:'lr_no',label:'LR number',type:'text' },
      { key:'freight',label:'Freight',type:'number',min:'0' },
      { key:'items',label:'Dispatch lines',type:'items' }
    ]
  },
  purchase: {
    title: 'Purchase Orders', endpoint: '/operations/purchase-orders',
    columns: [['purchase_no','Purchase #'],['supplier_name','Supplier'],['purchase_date','Date'],['grand_total','Total'],['status','Status']],
    fields: [
      { key:'purchase_no',label:'Purchase number',type:'text',required:true },
      { key:'supplier_id',label:'Supplier',type:'relation',endpoint:'/masters/parties',filter:'supplier',required:true },
      { key:'purchase_date',label:'Purchase date',type:'date',required:true,today:true },
      { key:'items',label:'Purchase lines',type:'items' }
    ],
    action:'receive'
  },
  stock: {
    title:'Stock by Warehouse', endpoint:'/operations/stock',
    columns:[['product_name','Product'],['sku','SKU'],['warehouse_name','Warehouse'],['quantity','Available quantity']],
    fields:[]
  },
  invoices: {
    title:'Invoices', endpoint:'/operations/invoices',
    columns:[['invoice_no','Invoice #'],['invoice_type','Type'],['party_name','Party'],['invoice_date','Date'],['grand_total','Total'],['status','Status']],
    fields:[
      { key:'invoice_no',label:'Invoice number',type:'text',required:true },
      { key:'invoice_type',label:'Invoice type',type:'select',options:['SALE','PURCHASE'],required:true },
      { key:'party_id',label:'Customer / supplier',type:'relation',endpoint:'/masters/parties',required:true },
      { key:'order_id',label:'Dispatched sales order (optional)',type:'relation',endpoint:'/operations/sales-orders',filter:'invoiceOrder',emptyLabel:'No linked order' },
      { key:'invoice_date',label:'Invoice date',type:'date',required:true,today:true },
      { key:'due_date',label:'Due date',type:'date' },
      { key:'items',label:'Invoice lines',type:'invoiceItems' }
    ]
  },
  payments: {
    title:'Receipts & Payments', endpoint:'/operations/payments',
    columns:[['payment_no','Voucher #'],['payment_type','Type'],['party_name','Party'],['payment_date','Date'],['mode','Mode'],['amount','Amount'],['allocated_amount','Allocated']],
    fields:[
      { key:'payment_no',label:'Receipt/payment number',type:'text',required:true },
      { key:'payment_type',label:'Type',type:'select',options:['RECEIPT','PAYMENT'],required:true },
      { key:'party_id',label:'Customer / supplier',type:'relation',endpoint:'/masters/parties',required:true },
      { key:'payment_date',label:'Date',type:'date',required:true,today:true },
      { key:'mode',label:'Payment mode',type:'select',options:['CASH','BANK','UPI','CHEQUE','NEFT','RTGS','OTHER'],required:true },
      { key:'amount',label:'Amount',type:'number',min:'0.01',required:true },
      { key:'allocation_invoice',label:'Allocate to invoice (optional)',type:'relation',endpoint:'/operations/invoices',filter:'invoice',emptyLabel:'Leave unallocated' },
      { key:'allocation_amount',label:'Amount to allocate',type:'number',min:'0.01' },
      { key:'reference_no',label:'Reference number',type:'text' },
      { key:'notes',label:'Notes',type:'textarea' }
    ]
  },
  expenses: {
    title:'Expenses', endpoint:'/operations/expenses',
    columns:[['expense_no','Expense #'],['category_name','Category'],['expense_date','Date'],['paid_to','Paid to'],['amount','Amount'],['status','Status']],
    fields:[
      { key:'expense_no',label:'Expense number',type:'text',required:true },
      { key:'category',label:'Category',type:'text',required:true },
      { key:'expense_date',label:'Date',type:'date',required:true,today:true },
      { key:'amount',label:'Amount',type:'number',min:'0.01',required:true },
      { key:'paid_to',label:'Paid to',type:'text' },
      { key:'payment_mode',label:'Payment mode',type:'select',options:['CASH','BANK','UPI','CHEQUE','NEFT','RTGS','OTHER'] },
      { key:'status',label:'Status',type:'select',options:['PENDING','PAID'] },
      { key:'notes',label:'Notes',type:'textarea' }
    ]
  },
  transport: {
    title:'Transport Entries', endpoint:'/operations/transport',
    columns:[['dispatch_no','Dispatch #'],['transporter_name','Transporter'],['vehicle_no','Vehicle'],['lr_no','LR #'],['freight','Freight'],['payment_status','Payment'],['entry_date','Date']],
    fields:[
      { key:'dispatch_id',label:'Dispatch (optional)',type:'relation',endpoint:'/operations/dispatches',emptyLabel:'No linked dispatch' },
      { key:'transporter_name',label:'Transporter',type:'text' },
      { key:'vehicle_no',label:'Vehicle number',type:'text' },
      { key:'driver_name',label:'Driver name',type:'text' },
      { key:'lr_no',label:'LR number',type:'text' },
      { key:'freight',label:'Freight',type:'number',min:'0' },
      { key:'loading_charges',label:'Loading charges',type:'number',min:'0' },
      { key:'unloading_charges',label:'Unloading charges',type:'number',min:'0' },
      { key:'payment_status',label:'Payment status',type:'select',options:['PENDING','PAID'] },
      { key:'entry_date',label:'Entry date',type:'date',required:true,today:true }
    ]
  },
  ledger: {
    title:'Party Ledger', endpoint:'/operations/ledger',
    columns:[['entry_date','Date'],['party_name','Party'],['voucher_type','Voucher'],['narration','Narration'],['debit','Debit'],['credit','Credit']],
    fields:[]
  },
  team: {
    title:'Sales Team', endpoint:'/operations/team',
    columns:[['employee_code','Code'],['full_name','Name'],['designation','Designation'],['department','Department'],['phone','Phone'],['email','Email']],
    fields:[
      { key:'employee_code',label:'Employee code',type:'text' },
      { key:'full_name',label:'Full name',type:'text',required:true },
      { key:'designation',label:'Designation',type:'text' },
      { key:'department',label:'Department',type:'text' },
      { key:'phone',label:'Phone',type:'tel' },
      { key:'email',label:'Email',type:'email' }
    ]
  }
};

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
    'X-Company-Id': session.companyId
  };
}

function formatApiError(data) {
  if (data.error === 'API endpoint not found') {
    return 'This Phoenix server has not loaded the latest record actions yet. Restart the backend server, then refresh this page.';
  }
  const details = data.details
    ?.map(issue => {
      const path = issue.path?.map(String) || [];
      const field = path[path.length - 1] || '';
      const labels = { gstin: 'GSTIN', pan: 'PAN', email: 'Email' };
      const label = labels[field] || field.replaceAll('_', ' ');
      if (issue.code === 'too_big' && issue.type === 'string') {
        return `${label} must be ${issue.maximum} characters or fewer.`;
      }
      if (field === 'email' && issue.validation === 'email') {
        return 'Enter a valid email address.';
      }
      return label ? `${path.length > 1 ? `${path.slice(0, -1).join('.')}.` : ''}${label}: ${issue.message}` : issue.message;
    })
    .filter(Boolean);
  return details?.length
    ? `Please check the following: ${details.join(' ')}`
    : data.error || 'Request failed';
}

async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw Error(formatApiError(data));
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === 'signup';
  $('#companyFields').hidden = !signingUp;
  $('#companyName').required = signingUp;
  $('#ownerName').required = signingUp;
  $('#password').minLength = signingUp ? 12 : 1;
  $('#password').autocomplete = signingUp ? 'new-password' : 'current-password';
  $('#passwordHint').hidden = !signingUp;
  $('#authTitle').textContent = signingUp ? 'Create your workspace' : 'Welcome back';
  $('#authDescription').textContent = signingUp
    ? 'Set up your company and owner account'
    : 'Sign in to your business workspace';
  $('#authSubmit').textContent = signingUp ? 'Create company account' : 'Sign in';
  $('#authSwitchText').textContent = signingUp ? 'Already have an account?' : 'New to Phoenix?';
  $('#authToggle').textContent = signingUp ? 'Sign in' : 'Create a company account';
  $('#loginError').textContent = '';
}

function enterWorkspace(data) {
  session = {
    token: data.token,
    user: data.user,
    companies: data.companies,
    companyId: data.companies.find(company => company.is_default)?.id || data.companies[0]?.id
  };
  if (!session.companyId) throw Error('No company is assigned to this user. Ask an administrator.');
  $('#loginPanel').remove();
  $('#userAvatar').textContent = data.user.name[0].toUpperCase();
  $('#companySelect').innerHTML = data.companies
    .map(company => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`)
    .join('');
  $('#companySelect').value = session.companyId;
  showPage('dashboard');
}

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const payload = {
    email: $('#email').value.trim(),
    password: $('#password').value
  };
  if (authMode === 'signup') {
    payload.companyName = $('#companyName').value.trim();
    payload.name = $('#ownerName').value.trim();
  }

  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw Error(formatApiError(data));
    }
    enterWorkspace(data);
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
});

$('#authToggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
$('#companySelect').addEventListener('change', event => {
  session.companyId = event.target.value;
  showPage('dashboard');
});
$('#logoutBtn').addEventListener('click', () => location.reload());
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => {
  showPage(link.dataset.page);
  $('#sidebar').classList.remove('open');
}));

async function showPage(page) {
  const link = document.querySelector(`.nav-link[data-page="${page}"]`);
  document.querySelectorAll('.nav-link').forEach(item => item.classList.toggle('active', item === link));
  const title = link?.textContent.trim().replace(/^[^\p{L}\p{N}]+\s*/u, '') || page;
  $('#pageTitle').textContent = title;
  const root = $('#content');
  root.innerHTML = '<div class="empty-state">Loading workspace…</div>';

  if (page === 'dashboard') return renderDashboard();
  if (crmViews[page]) return renderCrm(page);
  if (page === 'parties' || page === 'products') return renderMaster(page);
  if (page === 'custom') return renderCustom();
  if (operationViews[page]) return renderOperations(page);
  if (page === 'reports') return renderReports();
  if (page === 'settings') return renderSettings();
  root.innerHTML = `<div class="panel"><div class="panel-title">${escapeHtml(title)}</div><div class="empty-state"><div style="font-size:28px;margin-bottom:10px">◈</div><b>${escapeHtml(title)} module foundation is ready</b><p class="mt-2">This module is included in the architecture. Its transaction workflow, validations, and reports are the next development layer.</p></div></div>`;
}

async function renderDashboard() {
  try {
    const [data, report] = await Promise.all([
      api('/crm/summary'),
      api('/operations/reports/summary')
    ]);
    $('#content').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div><h2 class="h5 mb-1">Business overview</h2><div class="panel-sub">${escapeHtml(session.companies.find(company => company.id === session.companyId)?.name || '')}</div></div>
        <span class="badge text-bg-success">Workspace ready</span>
      </div>
      <div class="kpi-grid">
        ${[
          ['Leads', data.leads, '♙', 'leads'],
          ['Contacts', data.contacts, '♧', 'contacts'],
          ['Open deals', data.openDeals, '◇', 'deals'],
          ['Open activities', data.openActivities, '✓', 'activities'],
          ['Sales invoiced', money(report.sales.total), '₹', 'invoices'],
          ['Receivables', money(report.receivables), '↙', 'ledger'],
          ['Purchase invoiced', money(report.purchases.total), '＋', 'purchase'],
          ['Stock value', money(report.stockValue), '▥', 'stock']
        ].map(([label, value, icon, page]) => `<button class="kpi kpi-button" data-open="${page}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${icon} &nbsp; View records</div></button>`).join('')}
      </div>
      <div class="panel pipeline-summary"><div><div class="panel-title">Open pipeline value</div><div class="panel-sub">Total value of deals not yet won or lost</div></div><strong>${money(data.pipelineValue)}</strong></div>
      <div class="panel"><div class="panel-title">CRM workspace</div><div class="panel-sub">Manage your customer relationships from one place</div><div class="module-grid">${quickModules.map(([name, description, icon, page]) => `<button class="module-tile" data-open="${page}"><span class="tile-icon">${icon}</span><b>${name}</b><small>${description}</small></button>`).join('')}</div></div>`;
    document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.open)));
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-warning">${escapeHtml(error.message)}<div class="mt-2">If this is a fresh setup, apply database changes using <code>npm run db:migrate</code>.</div></div>`;
  }
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { dateStyle: 'medium' });
}

function recordLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function recordValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('_date') || key === 'due_date' || key === 'due_at') return displayDate(value);
  if (key.endsWith('_total') || ['amount', 'grand_total', 'subtotal', 'discount_total', 'tax_total', 'taxable_amount', 'tax_amount',
    'cgst_amount', 'sgst_amount', 'igst_amount', 'freight', 'loading_charges', 'unloading_charges',
    'debit', 'credit', 'allocated_amount', 'sale_rate', 'purchase_rate', 'credit_limit', 'rate',
    'line_total', 'unit_cost'].includes(key)) return money(value);
  if (['status', 'stage', 'invoice_type', 'payment_type', 'payment_status', 'party_type'].includes(key)) {
    return stageLabel(String(value));
  }
  return String(value);
}

function recordDetailsMarkup(record) {
  const hidden = new Set(['id', 'company_id', 'created_by', 'updated_at', 'created_at']);
  return Object.entries(record).filter(([key]) => !hidden.has(key)).map(([key, value]) => {
    if (Array.isArray(value)) {
      const entries = value.length
        ? `<div class="detail-lines">${value.map(item => `<div class="detail-line">${Object.entries(item).filter(([field]) => field !== 'id').map(([field, detail]) => `<span><small>${escapeHtml(recordLabel(field))}</small><b>${escapeHtml(recordValue(field, detail))}</b></span>`).join('')}</div>`).join('')}</div>`
        : '<span>—</span>';
      return `<div class="detail-field detail-field-wide"><small>${escapeHtml(recordLabel(key))}</small>${entries}</div>`;
    }
    if (value && typeof value === 'object') value = JSON.stringify(value);
    return `<div class="detail-field"><small>${escapeHtml(recordLabel(key))}</small><b>${escapeHtml(recordValue(key, value))}</b></div>`;
  }).join('');
}

function downloadRecordPdf(title, record) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups to print or save this record as a PDF.');
    return;
  }
  const fields = recordDetailsMarkup(record);
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font:14px Arial,sans-serif;color:#172b22;margin:32px}h1{font-size:22px;margin:0 0 6px}
    p{color:#64746b;margin:0 0 24px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .detail-field{padding:10px 12px;border:1px solid #dfe8e2;border-radius:8px;break-inside:avoid}
    .detail-field small{display:block;color:#64746b;margin-bottom:5px}.detail-field b{font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
    .detail-field-wide{grid-column:1/-1}.detail-lines{display:grid;gap:7px}.detail-line{display:flex;flex-wrap:wrap;gap:12px;padding:8px;background:#f6f9f7;border-radius:6px}
    .detail-line span{display:grid;gap:3px}@media print{body{margin:18mm}}
  </style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(session.companies.find(company => company.id === session.companyId)?.name || 'Phoenix Business Suite')} · ${new Date().toLocaleDateString('en-IN')}</p><main class="detail-grid">${fields}</main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function renderRecordActions(record, options = {}) {
  const id = escapeHtml(record.id || `${record.product_id}::${record.warehouse_id}`);
  const buttons = [`<button type="button" class="btn btn-sm btn-light" data-record-action="details" data-record-id="${id}">Details</button>`,
    `<button type="button" class="btn btn-sm btn-outline-secondary" data-record-action="pdf" data-record-id="${id}" aria-label="Print or save PDF">PDF</button>`];
  if (options.editable) buttons.push(`<button type="button" class="btn btn-sm btn-outline-success" data-record-action="edit" data-record-id="${id}">Edit</button>`);
  if (options.deletable) buttons.push(`<button type="button" class="btn btn-sm btn-outline-danger" data-record-action="delete" data-record-id="${id}">${options.archive ? 'Archive' : 'Delete'}</button>`);
  return `<div class="record-actions">${buttons.join(' ')}</div>`;
}

function recordKey(record) {
  return record.id || `${record.product_id}::${record.warehouse_id}`;
}

function recordLockMessage(options, record) {
  return typeof options.lockMessage === 'function' ? options.lockMessage(record) : options.lockMessage;
}

function openRecordDetails(title, record, options = {}) {
  const detailRecord = options.toDetails ? options.toDetails(record) : record;
  const lockMessage = recordLockMessage(options, record);
  const actionId = escapeHtml(recordKey(record));
  const modal = document.createElement('div');
  modal.className = 'modal fade show record-detail-modal';
  modal.style = 'display:block;background:#10251b66';
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content"><div class="modal-header"><div><div class="page-eyebrow">ENTRY DETAILS</div><h2 class="modal-title">${escapeHtml(title)}</h2></div><button type="button" class="btn-close" aria-label="Close" data-detail-close></button></div><div class="modal-body"><div class="detail-grid">${recordDetailsMarkup(detailRecord)}</div>${lockMessage ? `<div class="alert alert-light border mt-3 mb-0">${escapeHtml(lockMessage)}</div>` : ''}</div><div class="modal-footer"><button type="button" class="btn btn-light" data-detail-close>Close</button>${options.editable ? `<button type="button" class="btn btn-outline-success" data-record-action="edit" data-record-id="${actionId}">Edit entry</button>` : ''}${options.deletable ? `<button type="button" class="btn btn-outline-danger" data-record-action="delete" data-record-id="${actionId}">${options.archive ? 'Archive' : 'Delete'}</button>` : ''}<button type="button" class="btn btn-primary" data-record-action="pdf" data-record-id="${actionId}">Print / Save PDF</button></div></div></div>`;
  document.body.append(modal);
  modal.querySelectorAll('[data-detail-close]').forEach(button => button.onclick = () => modal.remove());
  wireRecordActions(modal, [record], { ...options, title, closeModal: () => modal.remove() });
}

function wireRecordActions(root, records, options) {
  const byId = new Map(records.map(record => [recordKey(record), record]));
  root.querySelectorAll('[data-record-action]').forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      const record = byId.get(button.dataset.recordId);
      if (!record) return;
      const permitted = typeof options.canChange === 'function' ? options.canChange(record) : {
        editable: Boolean(options.editable), deletable: Boolean(options.deletable)
      };
      if (button.dataset.recordAction === 'details') {
        openRecordDetails(options.title, record, {
          ...options,
          ...permitted,
          lockMessage: recordLockMessage(options, record)
        });
      } else if (button.dataset.recordAction === 'pdf') {
        downloadRecordPdf(options.title, options.toDetails ? options.toDetails(record) : record);
      } else if (button.dataset.recordAction === 'edit' && permitted.editable) {
        options.closeModal?.();
        options.onEdit(record);
      } else if (button.dataset.recordAction === 'delete' && permitted.deletable) {
        const label = record[options.labelField] || record.name || record.full_name ||
          (options.toDetails ? Object.values(options.toDetails(record))[0] : null) || options.title;
        const verb = options.archive ? 'Archive' : 'Delete';
        if (!confirm(`${verb} "${label}"? ${options.archive ? 'It will be hidden from active records.' : 'This action cannot be undone.'}`)) return;
        try {
          await api(`${options.endpoint}/${record.id}`, { method: 'DELETE' });
          options.closeModal?.();
          await options.reload();
        } catch (error) {
          alert(error.message);
        }
      }
    };
  });
  root.querySelectorAll('[data-record-id].record-clickable').forEach(row => {
    row.onclick = event => {
      if (event.target.closest('button,select,a,input')) return;
      const record = byId.get(row.dataset.recordId);
      if (!record) return;
      const permitted = typeof options.canChange === 'function' ? options.canChange(record) : {
        editable: Boolean(options.editable), deletable: Boolean(options.deletable)
      };
      openRecordDetails(options.title, record, { ...options, ...permitted, lockMessage: recordLockMessage(options, record) });
    };
    row.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      }
    };
  });
}

async function renderCrm(type) {
  const view = crmViews[type];
  try {
    const [rows, related] = await Promise.all([
      api(view.endpoint),
      type === 'deals' || type === 'activities'
        ? Promise.all([api('/crm/contacts'), api('/crm/leads'), api('/crm/deals')])
        : Promise.resolve([])
    ]);
    const [contacts, leads, deals] = related;
    const contactNames = new Map((contacts || []).map(contact => [contact.id, contact.name]));
    const leadNames = new Map((leads || []).map(lead => [lead.id, lead.name]));
    const dealNames = new Map((deals || []).map(deal => [deal.id, deal.name]));
    const records = rows.map(record => ({ ...record,
      contact_name: contactNames.get(record.contact_id) || '—',
      lead_name: leadNames.get(record.lead_id) || '—'
    }));

    $('#content').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div><h2 class="h5 mb-1">${view.title}</h2><div class="panel-sub">${rows.length} records in this company</div></div>
        <button class="btn btn-primary" id="addCrmRecord">+ Add ${view.singular}</button>
      </div>
      ${type === 'deals' ? renderDealPipeline(records) : ''}
      <div class="panel">
        <input id="crmSearch" class="form-control mb-3" placeholder="Search ${view.title.toLowerCase()}…">
        <div class="table-responsive"><table class="table table-hover align-middle">
          <thead><tr>${view.columns.map(([, label]) => `<th>${label}</th>`).join('')}${type === 'leads' ? '<th>Status</th>' : ''}${type === 'deals' ? '<th>Stage</th>' : ''}${type === 'activities' ? '<th>Status</th>' : ''}<th>Actions</th></tr></thead>
          <tbody id="crmRows">${records.map(record => renderCrmRow(type, view, record)).join('') || `<tr><td colspan="${view.columns.length + (type === 'contacts' ? 1 : 2)}" class="text-center text-muted py-4">No ${view.title.toLowerCase()} yet. Add your first record.</td></tr>`}</tbody>
        </table></div>
      </div>`;
    $('#crmSearch').oninput = event => {
      const query = event.target.value.toLowerCase();
      [...$('#crmRows').rows].forEach(row => { row.hidden = !row.innerText.toLowerCase().includes(query); });
    };
    $('#addCrmRecord').onclick = () => openCrmForm(type, { contacts, leads, deals });
    wireRecordActions($('#content'), records, {
      title: view.singular, endpoint: view.endpoint, labelField: 'name', editable: true, deletable: true,
      onEdit: record => openCrmForm(type, { contacts, leads, deals }, record),
      reload: () => renderCrm(type)
    });
    document.querySelectorAll('[data-status]').forEach(select => {
      const updateStatus = async value => {
        try {
          await api(`/crm/${type}/${select.dataset.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ [select.dataset.status]: value })
          });
          await renderCrm(type);
        } catch (error) {
          alert(error.message);
          await renderCrm(type);
        }
      };
      if (select.tagName === 'SELECT') {
        select.onchange = () => updateStatus(select.value);
      } else {
        select.onclick = () => updateStatus(select.dataset.next);
      }
    });
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

function renderDealPipeline(records) {
  const stages = ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
  return `<div class="pipeline-grid">${stages.map(stage => {
    const deals = records.filter(record => record.stage === stage);
    return `<section class="pipeline-column"><div class="pipeline-heading">${stageLabel(stage)} <span>${deals.length}</span></div>${deals.map(deal => `<article class="pipeline-deal record-clickable" tabindex="0" data-record-id="${escapeHtml(deal.id)}"><b>${escapeHtml(deal.name)}</b><strong>${money(deal.amount)}</strong><small>${escapeHtml(deal.contact_name)}</small></article>`).join('') || '<div class="pipeline-empty">No deals</div>'}</section>`;
  }).join('')}</div>`;
}

function stageLabel(stage) {
  return stage.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function renderCrmRow(type, view, record) {
  const cells = view.columns.map(([key]) => {
    const value = record[key];
    if (key === 'amount') return `<td>${money(value)}</td>`;
    if (key === 'expected_close_date' || key === 'due_at') return `<td>${displayDate(value)}</td>`;
    return `<td>${escapeHtml(value || '—')}</td>`;
  }).join('');
  const options = (values, current) => values.map(value => `<option value="${value}" ${current === value ? 'selected' : ''}>${stageLabel(value)}</option>`).join('');
  const status = type === 'leads'
    ? `<td><select class="form-select form-select-sm" data-status="status" data-id="${record.id}">${options(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'], record.status)}</select></td>`
    : type === 'deals'
      ? `<td><select class="form-select form-select-sm" data-status="stage" data-id="${record.id}">${options(['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'], record.stage)}</select></td>`
      : type === 'activities'
        ? `<td><button class="btn btn-sm ${record.status === 'COMPLETED' ? 'btn-light' : 'btn-outline-success'}" data-status="status" data-id="${record.id}" data-next="${record.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED'}">${record.status === 'COMPLETED' ? 'Completed' : 'Mark done'}</button></td>`
        : '';
  return `<tr class="record-clickable" tabindex="0" data-record-id="${escapeHtml(record.id)}">${cells}${status}<td>${renderRecordActions(record, { editable: true, deletable: true })}</td></tr>`;
}

async function openCrmForm(type, related, existing = null) {
  const view = crmViews[type];
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.style = 'display:block;background:#10251b66';
  const controls = await Promise.all(view.fields.map(async field => {
    const required = field.required ? 'required' : '';
    const label = `<label class="form-label" for="crm-${field.key}">${field.label}${field.required ? ' *' : ''}</label>`;
    let control;
    if (field.type === 'select') {
      const choices = field.options.map(option => `<option value="${option}">${stageLabel(option)}</option>`).join('');
      control = `<select class="form-select" id="crm-${field.key}" name="${field.key}">${choices}</select>`;
    } else if (field.type === 'relation') {
      const key = field.endpoint.split('/').pop();
      const records = related[key] || await api(field.endpoint);
      const choices = records.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.name)}</option>`).join('');
      control = `<select class="form-select" id="crm-${field.key}" name="${field.key}"><option value="">${field.emptyLabel}</option>${choices}</select>`;
    } else if (field.type === 'textarea') {
      control = `<textarea class="form-control" id="crm-${field.key}" name="${field.key}" rows="3"></textarea>`;
    } else {
      control = `<input class="form-control" id="crm-${field.key}" name="${field.key}" type="${field.type}" ${field.min ? `min="${field.min}"` : ''} ${required}>`;
    }
    return `<div class="col-md-6">${label}${control}</div>`;
  }));
  if (!existing) controls.unshift(manualIdField('crm-id'));
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content"><form id="crmForm"><div class="modal-header"><h5 class="modal-title">${existing ? 'Edit' : 'Add'} ${view.singular}</h5><button type="button" class="btn-close" id="closeCrmModal"></button></div><div class="modal-body row g-3">${controls.join('')}<div class="col-12"><div class="form-feedback" id="crmFormError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" id="cancelCrmModal">Cancel</button><button class="btn btn-primary">${existing ? 'Save changes' : `Save ${view.singular.toLowerCase()}`}</button></div></form></div></div>`;
  document.body.append(modal);
  if (existing) {
    for (const field of view.fields) {
      const control = modal.querySelector(`[name="${field.key}"]`);
      if (!control || existing[field.key] === null || existing[field.key] === undefined) continue;
      control.value = field.type === 'datetime-local' ? new Date(existing[field.key]).toISOString().slice(0, 16) : existing[field.key];
    }
  }
  const close = () => modal.remove();
  $('#closeCrmModal').onclick = close;
  $('#cancelCrmModal').onclick = close;
  $('#crmForm').onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    for (const [key, value] of Object.entries(data)) {
      if (value === '') {
        if (existing && !view.fields.find(field => field.key === key)?.required) data[key] = null;
        else delete data[key];
      } else if (key === 'amount') {
        data[key] = Number(value);
      } else if (key === 'due_at') {
        data[key] = new Date(value).toISOString();
      }
    }
    try {
      await api(existing ? `${view.endpoint}/${existing.id}` : view.endpoint, {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify(data)
      });
      close();
      await renderCrm(type);
    } catch (error) {
      $('#crmFormError').textContent = error.message;
    }
  };
}

async function renderMaster(type) {
  const isParty = type === 'parties';
  const label = isParty ? 'Party' : 'Product';
  try {
    const rows = await api(`/masters/${type}`);
    $('#content').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3"><div><h2 class="h5 mb-1">${label} Master</h2><div class="panel-sub">Company-specific master records</div></div><button class="btn btn-primary" id="addBtn">+ Add ${label}</button></div>
      <div class="panel"><input id="searchRows" class="form-control mb-3" placeholder="Search ${label.toLowerCase()}…"><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr>${(isParty ? ['Code', 'Name', 'Type', 'GSTIN', 'Phone'] : ['SKU', 'Name', 'Category', 'Unit', 'Sale Rate', 'GST']).map(value => `<th>${value}</th>`).join('')}<th>Actions</th></tr></thead><tbody id="masterRows">${rows.map(row => `<tr class="record-clickable" tabindex="0" data-record-id="${escapeHtml(row.id)}">${(isParty ? [row.party_code, row.name, row.party_type, row.gstin, row.phone] : [row.sku, row.name, row.category, row.unit, money(row.sale_rate), `${row.gst_rate}%`]).map(value => `<td>${escapeHtml(value ?? '—')}</td>`).join('')}<td>${renderRecordActions(row, { editable: true, deletable: true, archive: true })}</td></tr>`).join('') || `<tr><td colspan="${isParty ? 6 : 7}" class="text-center text-muted py-4">No records yet. Add your first record.</td></tr>`}</tbody></table></div></div>`;
    $('#searchRows').oninput = event => {
      const query = event.target.value.toLowerCase();
      [...$('#masterRows').rows].forEach(row => { row.hidden = !row.innerText.toLowerCase().includes(query); });
    };
    $('#addBtn').onclick = () => openMasterForm(type);
    wireRecordActions($('#content'), rows, {
      title: label, endpoint: `/masters/${type}`, labelField: 'name', editable: true, deletable: true, archive: true,
      onEdit: record => openMasterForm(type, record),
      reload: () => renderMaster(type)
    });
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

function openMasterForm(type, existing = null) {
  const party = type === 'parties';
  const fields = (party
    ? [['name', 'Party Name', 'text', true], ['party_code', 'Party Code', 'text'], ['party_type', 'Party Type', 'select'], ['gstin', 'GSTIN', 'text'], ['pan', 'PAN', 'text'], ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'], ['state', 'State', 'text'], ['credit_limit', 'Credit Limit', 'number'], ['billing_address', 'Billing Address', 'textarea']]
    : [['name', 'Product Name', 'text', true], ['sku', 'SKU / Code', 'text'], ['category', 'Category', 'text'], ['hsn_code', 'HSN Code', 'text'], ['unit', 'Unit', 'text'], ['pack_size', 'Pack Size', 'number'], ['sale_rate', 'Sale Rate', 'number'], ['purchase_rate', 'Purchase Rate', 'number'], ['gst_rate', 'GST %', 'number']]);
  if (!existing) fields.unshift(['id', 'Record ID (UUID)', 'text', true]);
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.style = 'display:block;background:#10251b66';
  const fieldLimits = { id: 36, gstin: 15, pan: 10, email: 180, party_code: 50, phone: 30, sku: 80, category: 100, hsn_code: 20, unit: 20 };
  const fieldHints = { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', gstin: 'Up to 15 characters', pan: 'Up to 10 characters', email: 'name@company.com' };
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form id="masterForm"><div class="modal-header"><h5 class="modal-title">${existing ? 'Edit' : 'Add'} ${party ? 'Party' : 'Product'}</h5><button type="button" class="btn-close" id="closeModal"></button></div><div class="modal-body row g-3">${fields.map(([key, label, type, required]) => {
    const limit = fieldLimits[key];
    const inputAttrs = `${limit ? `maxlength="${limit}"` : ''} ${fieldHints[key] ? `placeholder="${fieldHints[key]}"` : ''} ${key === 'id' ? 'minlength="36" pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" title="Enter a valid UUID" autocomplete="off"' : ''} ${key === 'gstin' || key === 'pan' ? 'autocapitalize="characters"' : ''}`;
    return `<div class="col-md-6"><label class="form-label" for="master-${key}">${label}${required ? ' *' : ''}</label>${type === 'select' ? '<select class="form-select" id="master-party_type" name="party_type"><option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option><option value="BOTH">Both</option></select>' : type === 'textarea' ? `<textarea class="form-control" id="master-${key}" name="${key}"></textarea>` : `<input class="form-control" id="master-${key}" name="${key}" type="${type}" ${inputAttrs} ${required ? 'required' : ''}>`}</div>`;
  }).join('')}<div class="col-12"><div class="form-feedback" id="formError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" id="cancelModal">Cancel</button><button class="btn btn-primary">${existing ? 'Save changes' : 'Save record'}</button></div></form></div></div>`;
  document.body.append(modal);
  if (existing) {
    for (const [key] of fields) {
      const control = modal.querySelector(`[name="${key}"]`);
      if (control && existing[key] !== null && existing[key] !== undefined) control.value = existing[key];
    }
  }
  const close = () => modal.remove();
  $('#closeModal').onclick = close;
  $('#cancelModal').onclick = close;
  modal.querySelectorAll('[name="gstin"], [name="pan"]').forEach(input => {
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
  });
  $('#masterForm').onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    for (const key of Object.keys(data)) {
      if (data[key] !== '') continue;
      if (existing && !['credit_limit', 'pack_size', 'sale_rate', 'purchase_rate', 'gst_rate'].includes(key)) data[key] = null;
      else delete data[key];
    }
    for (const key of ['gstin', 'pan']) if (data[key]) data[key] = data[key].trim().toUpperCase();
    if (data.email) data.email = data.email.trim();
    ['credit_limit', 'pack_size', 'sale_rate', 'purchase_rate', 'gst_rate'].forEach(key => {
      if (data[key] !== undefined) data[key] = Number(data[key]);
    });
    try {
      await api(existing ? `/masters/${type}/${existing.id}` : `/masters/${type}`, {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify(data)
      });
      close();
      await renderMaster(type);
    } catch (error) {
      $('#formError').textContent = error.message;
    }
  };
}

async function renderCustom() {
  try {
    const rows = await api('/custom/modules');
    $('#content').innerHTML = `<div class="d-flex justify-content-between align-items-center mb-3"><div><h2 class="h5 mb-1">Custom Section Builder</h2><div class="panel-sub">Create company-specific data modules and manage their records</div></div><button class="btn btn-primary" id="newModule">+ Create Section</button></div><div class="row g-3">${rows.map(module => `<div class="col-md-4"><div class="panel h-100"><div class="tile-icon">▦</div><b>${escapeHtml(module.name)}</b><p class="panel-sub mt-2">${escapeHtml(module.description || 'Custom business section')} · ${(module.fields || []).length} fields</p><small class="text-muted">/${escapeHtml(module.slug)}</small><div class="mt-3"><button class="btn btn-sm btn-outline-success" data-manage-module="${escapeHtml(module.id)}">Manage fields & records</button></div></div></div>`).join('') || '<div class="col-12"><div class="panel empty-state">No custom sections created yet.</div></div>'}</div>`;
    $('#newModule').onclick = () => openCustomModuleForm();
    document.querySelectorAll('[data-manage-module]').forEach(button => {
      button.onclick = () => renderCustomModule(button.dataset.manageModule);
    });
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-warning">${escapeHtml(error.message)}</div>`;
  }
}

function openCustomModuleForm() {
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.style = 'display:block;background:#10251b66';
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form id="customModuleForm"><div class="modal-header"><h5 class="modal-title">Create Section</h5><button type="button" class="btn-close" data-module-close></button></div><div class="modal-body row g-3">${manualIdField('custom-module-id')}<div class="col-12"><label class="form-label" for="customModuleName">Section name *</label><input class="form-control" id="customModuleName" name="name" required minlength="2" maxlength="100"></div><div class="col-12"><div class="form-feedback" id="customModuleError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-module-close>Cancel</button><button class="btn btn-primary">Create Section</button></div></form></div></div>`;
  document.body.append(modal);
  const close = () => modal.remove();
  modal.querySelectorAll('[data-module-close]').forEach(button => button.onclick = close);
  modal.querySelector('#customModuleForm').onsubmit = async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = formData.get('name').trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      await api('/custom/modules', {
        method: 'POST',
        body: JSON.stringify({ id: formData.get('id'), name, slug })
      });
      close();
      await renderCustom();
    } catch (error) {
      modal.querySelector('#customModuleError').textContent = error.message;
    }
  };
}

async function renderCustomModule(moduleId) {
  try {
    const [modules, records] = await Promise.all([
      api('/custom/modules'),
      api(`/custom/modules/${moduleId}/records`)
    ]);
    const module = modules.find(item => item.id === moduleId);
    if (!module) throw Error('Custom section not found');
    const fields = module.fields || [];
    const recordRows = records.map(record => `<tr class="record-clickable" tabindex="0" data-record-id="${escapeHtml(record.id)}">${fields.map(field => {
      const value = record.data[field.field_key];
      return `<td>${escapeHtml(value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : value)}</td>`;
    }).join('')}<td>${renderRecordActions(record, { editable: true, deletable: true })}</td></tr>`).join('');
    $('#content').innerHTML = `<div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2"><div><button class="btn btn-sm btn-light mb-2" id="backCustom">← All sections</button><h2 class="h5 mb-1">${escapeHtml(module.name)}</h2><div class="panel-sub">${fields.length} fields · ${records.length} records</div></div><div><button class="btn btn-outline-success me-2" id="addCustomField">+ Add field</button><button class="btn btn-primary" id="addCustomRecord" ${fields.length ? '' : 'disabled'}>+ Add record</button></div></div><div class="panel"><div class="panel-title">Fields</div>${fields.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Required</th></tr></thead><tbody>${fields.map(field => `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(field.field_key)}</td><td>${escapeHtml(field.field_type)}</td><td>${field.is_required ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Add a field before creating records.</div>'}</div><div class="panel"><div class="panel-title">Records</div>${records.length ? `<div class="table-responsive"><table class="table table-hover align-middle"><thead><tr>${fields.map(field => `<th>${escapeHtml(field.label)}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${recordRows}</tbody></table></div>` : '<div class="empty-state">No records yet.</div>'}</div>`;
    $('#backCustom').onclick = renderCustom;
    $('#addCustomField').onclick = () => openCustomFieldForm(moduleId, fields.length);
    if (fields.length) $('#addCustomRecord').onclick = () => openCustomRecordForm(moduleId, fields);
    wireRecordActions($('#content'), records, {
      title: module.name,
      endpoint: `/custom/modules/${moduleId}/records`,
      labelField: fields[0]?.field_key,
      editable: true,
      deletable: true,
      toDetails: record => ({ ...record.data, id: record.id, created_at: record.created_at }),
      onEdit: record => openCustomRecordForm(moduleId, fields, record),
      reload: () => renderCustomModule(moduleId)
    });
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function openCustomFieldForm(moduleId, sortOrder) {
  const label = prompt('Field label?');
  if (!label) return;
  const field_key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!field_key || !/^[a-z]/.test(field_key)) {
    alert('Field label must produce a key that starts with a letter.');
    return;
  }
  const field_type = prompt('Field type: text, number, date, select, checkbox, textarea, email, phone', 'text');
  if (!field_type) return;
  const allowed = ['text', 'number', 'date', 'select', 'checkbox', 'textarea', 'email', 'phone'];
  if (!allowed.includes(field_type)) {
    alert('Choose a supported field type.');
    return;
  }
  const rawOptions = field_type === 'select' ? prompt('Select options, separated by commas?', 'Option 1, Option 2') : null;
  if (field_type === 'select' && rawOptions === null) return;
  const options = rawOptions ? rawOptions.split(',').map(value => value.trim()).filter(Boolean) : undefined;
  if (field_type === 'select' && !options.length) {
    alert('Add at least one select option.');
    return;
  }
  const is_required = confirm('Is this field required?');
  try {
    await api(`/custom/modules/${moduleId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ field_key, label: label.trim(), field_type, options, is_required, sort_order: sortOrder })
    });
    await renderCustomModule(moduleId);
  } catch (error) {
    alert(error.message);
  }
}

function openCustomRecordForm(moduleId, fields, existing = null) {
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.style = 'display:block;background:#10251b66';
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form id="customRecordForm"><div class="modal-header"><h5 class="modal-title">${existing ? 'Edit' : 'Add'} record</h5><button type="button" class="btn-close" id="closeCustomRecord"></button></div><div class="modal-body row g-3">${existing ? '' : manualIdField('custom-record-id')}${fields.map(field => {
    const required = field.is_required ? 'required' : '';
    const label = `<label class="form-label">${escapeHtml(field.label)}${field.is_required ? ' *' : ''}</label>`;
    let control;
    if (field.field_type === 'select') control = `<select class="form-select" name="${escapeHtml(field.field_key)}" ${required}><option value="">Choose…</option>${(field.options || []).map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>`;
    else if (field.field_type === 'textarea') control = `<textarea class="form-control" name="${escapeHtml(field.field_key)}" ${required}></textarea>`;
    else if (field.field_type === 'checkbox') control = `<div class="form-check"><input class="form-check-input" type="checkbox" name="${escapeHtml(field.field_key)}" ${required}><label class="form-check-label">${escapeHtml(field.label)}</label></div>`;
    else control = `<input class="form-control" name="${escapeHtml(field.field_key)}" type="${field.field_type === 'phone' ? 'tel' : field.field_type}" ${required}>`;
    return `<div class="col-md-6">${field.field_type === 'checkbox' ? control : `${label}${control}`}</div>`;
  }).join('')}<div class="col-12"><div class="form-feedback" id="customRecordError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" id="cancelCustomRecord">Cancel</button><button class="btn btn-primary">${existing ? 'Save changes' : 'Save record'}</button></div></form></div></div>`;
  document.body.append(modal);
  if (existing) {
    for (const field of fields) {
      const control = modal.querySelector(`[name="${field.field_key}"]`);
      const value = existing.data[field.field_key];
      if (!control || value === undefined || value === null) continue;
      if (field.field_type === 'checkbox') control.checked = value;
      else control.value = value;
    }
  }
  const close = () => modal.remove();
  $('#closeCustomRecord').onclick = close;
  $('#cancelCustomRecord').onclick = close;
  $('#customRecordForm').onsubmit = async event => {
    event.preventDefault();
    const data = {};
    for (const field of fields) {
      const input = Array.from(event.target.elements).find(control => control.name === field.field_key);
      if (field.field_type === 'checkbox') {
        data[field.field_key] = input.checked;
      } else if (input.value !== '') {
        data[field.field_key] = field.field_type === 'number' ? Number(input.value) : input.value;
      }
    }
    try {
      await api(existing
        ? `/custom/modules/${moduleId}/records/${existing.id}`
        : `/custom/modules/${moduleId}/records`, {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify(existing ? data : { ...data, _recordId: $('#custom-record-id').value })
      });
      close();
      await renderCustomModule(moduleId);
    } catch (error) {
      $('#customRecordError').textContent = error.message;
    }
  };
}

function operationCell(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (['amount', 'grand_total', 'freight', 'debit', 'credit', 'allocated_amount'].includes(key)) return money(value);
  if (key.endsWith('_date') || key === 'due_date') return displayDate(value);
  if (Array.isArray(value)) return `${value.length} line${value.length === 1 ? '' : 's'}`;
  if (key === 'status' || key === 'stage' || key === 'invoice_type' || key === 'payment_type' || key === 'payment_status') return stageLabel(value);
  return escapeHtml(value);
}

function statusControl(page, record) {
  const transitions = {
    orders: {
      DRAFT: [['SUBMITTED', 'Submit'], ['CANCELLED', 'Cancel']],
      SUBMITTED: [['APPROVED', 'Approve'], ['CANCELLED', 'Cancel']],
      APPROVED: [['CANCELLED', 'Cancel']],
      PARTIAL: [['CANCELLED', 'Cancel']]
    },
    dispatch: {
      DISPATCHED: [['IN_TRANSIT', 'In transit'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancel']],
      IN_TRANSIT: [['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancel']]
    },
    expenses: { PENDING: [['PAID', 'Mark paid']], PAID: [['PENDING', 'Mark pending']] },
    transport: { PENDING: [['PAID', 'Mark paid']], PAID: [['PENDING', 'Mark pending']] }
  };
  const next = transitions[page]?.[record.status || record.payment_status];
  if (!next?.length) return '';
  return `<select class="form-select form-select-sm operation-status" data-page="${page}" data-id="${escapeHtml(record.id)}" data-field="${page === 'transport' ? 'payment_status' : 'status'}"><option value="">Change status…</option>${next.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
}

function operationActionPermission(page, record) {
  if (page === 'orders' && record.status === 'DRAFT') return { editable: true, deletable: true };
  if (page === 'purchase' && record.status === 'DRAFT') return { editable: true, deletable: true };
  if (page === 'expenses' && record.status === 'PENDING') return { editable: true, deletable: true };
  if (page === 'transport' && record.payment_status === 'PENDING') return { editable: true, deletable: true };
  if (page === 'team' && record.is_active) return { editable: true, deletable: true, archive: true };
  return { editable: false, deletable: false };
}

function operationLockedMessage(page) {
  if (page === 'orders') return 'Only draft orders can be edited or deleted. Submitted and dispatched orders are protected.';
  if (page === 'purchase') return 'Only unreceived draft purchase orders can be edited or deleted.';
  if (page === 'dispatch') return 'Dispatches change stock. Use the status workflow to cancel; the stock reversal is recorded automatically.';
  if (page === 'invoices') return 'Invoices post to the party ledger and cannot be edited or deleted here.';
  if (page === 'payments') return 'Payments post to the party ledger and may allocate invoices, so they cannot be edited or deleted here.';
  if (page === 'stock') return 'Stock balances are derived from movements. Create a stock adjustment to correct quantities.';
  if (page === 'ledger') return 'Ledger entries are derived from invoices and payments and are read-only.';
  if (page === 'expenses') return 'Only pending expenses can be edited or deleted.';
  if (page === 'transport') return 'Only pending transport entries can be edited or deleted.';
  if (page === 'team') return 'Archived team members cannot be edited or deleted.';
  return 'This section is read-only.';
}

async function renderOperations(page) {
  const view = operationViews[page];
  try {
    const rows = await api(view.endpoint);
    const extraColumn = page === 'orders' || page === 'dispatch' || page === 'purchase' || page === 'expenses' || page === 'transport';
    const headers = view.columns.map(([, label]) => `<th>${label}</th>`).join('');
    $('#content').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div><h2 class="h5 mb-1">${view.title}</h2><div class="panel-sub">${rows.length} company records</div></div>
        <div>${page === 'stock' ? '<button class="btn btn-outline-success me-2" id="addWarehouse">+ Warehouse</button>' : ''}${view.fields.length ? `<button class="btn btn-primary" id="addOperation">+ New Entry</button>` : page === 'stock' ? '<button class="btn btn-primary" id="addOperation">+ Stock Adjustment</button>' : ''}</div>
      </div>
      <div class="panel">
        ${rows.length > 10 ? '<input id="operationSearch" class="form-control mb-3" placeholder="Search records…">' : ''}
        <div class="table-responsive"><table class="table table-hover align-middle"><thead><tr>${headers}${extraColumn ? '<th>Workflow</th>' : ''}<th>Actions</th></tr></thead>
        <tbody id="operationRows">${rows.map(record => {
          const permission = operationActionPermission(page, record);
          const workflow = extraColumn ? `<td>${statusControl(page,record)}${page === 'purchase' && record.status !== 'RECEIVED' && record.status !== 'CANCELLED' ? `<button class="btn btn-sm btn-outline-success receive-order mt-1" data-id="${escapeHtml(record.id)}">Receive stock</button>` : ''}</td>` : '';
          return `<tr class="record-clickable" tabindex="0" data-record-id="${escapeHtml(record.id || `${record.product_id}::${record.warehouse_id}`)}">${view.columns.map(([key]) => `<td>${operationCell(key,record[key])}</td>`).join('')}${workflow}<td>${renderRecordActions(record, permission)}</td></tr>`;
        }).join('') || `<tr><td colspan="${view.columns.length + (extraColumn ? 2 : 1)}" class="empty-state">No records yet.</td></tr>`}</tbody></table></div>
      </div>`;
    if ($('#operationSearch')) $('#operationSearch').oninput = event => {
      const query = event.target.value.toLowerCase();
      [...$('#operationRows').rows].forEach(row => { row.hidden = !row.innerText.toLowerCase().includes(query); });
    };
    $('#addOperation')?.addEventListener('click', () => page === 'stock'
      ? openOperationForm('stock')
      : openOperationForm(page));
    $('#addWarehouse')?.addEventListener('click', addWarehouse);
    const operationEndpoint = view.endpoint;
    wireRecordActions($('#content'), rows, {
      title: view.title,
      endpoint: operationEndpoint,
      labelField: view.columns[0]?.[0],
      canChange: record => operationActionPermission(page, record),
      lockMessage: operationLockedMessage(page),
      onEdit: record => openOperationForm(page, record),
      reload: () => renderOperations(page)
    });
    document.querySelectorAll('.operation-status').forEach(control => {
      control.onchange = async () => {
        if (!control.value) return;
        const field = control.dataset.field;
        const endpoint = control.dataset.page === 'orders'
          ? `/operations/sales-orders/${control.dataset.id}/status`
          : `/operations/${control.dataset.page === 'dispatch' ? 'dispatches' : control.dataset.page}/${control.dataset.id}/status`;
        try {
          await api(endpoint, { method:'PATCH', body:JSON.stringify({ [field]:control.value }) });
          await renderOperations(page);
        } catch (error) {
          alert(error.message);
          await renderOperations(page);
        }
      };
    });
    document.querySelectorAll('.receive-order').forEach(button => button.onclick = async () => {
      try {
        const warehouses = await api('/operations/warehouses');
        const warehouseId = await chooseWarehouse(warehouses);
        if (!warehouseId) return;
        await api(`/operations/purchase-orders/${button.dataset.id}/receive`, {
          method:'POST', body:JSON.stringify({ warehouse_id:warehouseId })
        });
        await renderOperations(page);
      } catch (error) {
        alert(error.message);
      }
    });
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function chooseWarehouse(warehouses) {
  if (!warehouses.length) {
    alert('Create a warehouse before receiving or adjusting stock.');
    return null;
  }
  if (warehouses.length === 1) return warehouses[0].id;
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style = 'display:block;background:#10251b66';
    modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Choose warehouse</h5><button type="button" class="btn-close" data-cancel></button></div><div class="modal-body"><select class="form-select" id="warehouseChoice">${warehouses.map(warehouse => `<option value="${escapeHtml(warehouse.id)}">${escapeHtml(warehouse.name)}</option>`).join('')}</select></div><div class="modal-footer"><button class="btn btn-light" data-cancel>Cancel</button><button class="btn btn-primary" data-confirm>Continue</button></div></div></div>`;
    document.body.append(modal);
    const close = value => { modal.remove(); resolve(value); };
    modal.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => close(null));
    modal.querySelector('[data-confirm]').onclick = () => close($('#warehouseChoice').value);
  });
}

async function addWarehouse() {
  openWarehouseForm();
}

function openWarehouseForm(existing = null, reload = () => renderOperations('stock')) {
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.style = 'display:block;background:#10251b66';
  modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form id="warehouseForm"><div class="modal-header"><h5 class="modal-title">${existing ? 'Edit' : 'Add'} warehouse</h5><button type="button" class="btn-close" data-warehouse-close></button></div><div class="modal-body row g-3">${existing ? '' : manualIdField('warehouse-id')}<div class="col-12"><label class="form-label" for="warehouseName">Warehouse name</label><input id="warehouseName" name="name" class="form-control" required maxlength="120" value="${escapeHtml(existing?.name || '')}"></div><div class="col-12"><div class="form-feedback" id="warehouseError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-warehouse-close>Cancel</button><button class="btn btn-primary">${existing ? 'Save changes' : 'Add warehouse'}</button></div></form></div></div>`;
  document.body.append(modal);
  const close = () => modal.remove();
  modal.querySelectorAll('[data-warehouse-close]').forEach(button => button.onclick = close);
  modal.querySelector('#warehouseForm').onsubmit = async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = formData.get('name').trim();
    try {
      await api(existing ? `/operations/warehouses/${existing.id}` : '/operations/warehouses', {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify(existing ? { name } : { id: formData.get('id'), name })
      });
      close();
      await reload();
    } catch (error) {
      modal.querySelector('#warehouseError').textContent = error.message;
    }
  };
}

async function loadOperationOptions(field) {
  const records = await api(field.endpoint);
  if (field.filter === 'customer') return records.filter(item => ['CUSTOMER','BOTH'].includes(item.party_type));
  if (field.filter === 'supplier') return records.filter(item => ['SUPPLIER','BOTH'].includes(item.party_type));
  if (field.filter === 'approved') return records.filter(item => ['APPROVED','PARTIAL'].includes(item.status));
  if (field.filter === 'invoiceOrder') return records.filter(item => ['PARTIAL','COMPLETED'].includes(item.status));
  if (field.filter === 'invoice') return records.filter(item => !['PAID','CANCELLED'].includes(item.status));
  return records;
}

function buildItemRow(kind, products) {
  const row = document.createElement('div');
  row.className = 'line-item-row';
  const invoice = kind === 'invoiceItems';
  row.innerHTML = `<select class="form-select line-product" aria-label="Product"><option value="">${invoice ? 'Free-text line' : 'Select product'}</option>${products.map(product => `<option value="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" data-sale="${product.sale_rate}" data-purchase="${product.purchase_rate}" data-gst="${product.gst_rate}">${escapeHtml(product.name)}${product.sku ? ` (${escapeHtml(product.sku)})` : ''}</option>`).join('')}</select>${invoice ? '<input class="form-control line-description" placeholder="Description">' : ''}<input class="form-control line-quantity" type="number" min="0.001" step="0.001" placeholder="Qty" required><input class="form-control line-rate" type="number" min="0" step="0.01" placeholder="Rate" required>${invoice ? '' : '<input class="form-control line-discount" type="number" min="0" step="0.01" placeholder="Discount" value="0">'}<input class="form-control line-tax" type="number" min="0" max="100" step="0.01" placeholder="GST %"><button type="button" class="btn btn-sm btn-outline-danger remove-line" aria-label="Remove line">×</button>`;
  row.querySelector('.line-product').onchange = event => {
    const option = event.target.selectedOptions[0];
    if (invoice && option.value) row.querySelector('.line-description').value = option.dataset.name;
    if (option.value) {
      row.querySelector('.line-rate').value = kind === 'purchase' ? option.dataset.purchase : option.dataset.sale;
      row.querySelector('.line-tax').value = option.dataset.gst;
    }
  };
  row.querySelector('.remove-line').onclick = () => row.remove();
  return row;
}

async function openOperationForm(page, existing = null) {
  const view = page === 'stock'
    ? { title:'Stock Adjustment',endpoint:'/operations/stock/adjustments',fields:[
      {key:'warehouse_id',label:'Warehouse',type:'relation',endpoint:'/operations/warehouses',required:true},
      {key:'product_id',label:'Product',type:'relation',endpoint:'/masters/products',required:true},
      {key:'movement_date',label:'Date',type:'date',today:true,required:true},
      {key:'direction',label:'Adjustment',type:'select',options:['IN','OUT'],required:true},
      {key:'quantity',label:'Quantity',type:'number',min:'0.001',required:true},
      {key:'unit_cost',label:'Unit cost',type:'number',min:'0'},
      {key:'notes',label:'Reason',type:'text'}
    ]} : operationViews[page];
  try {
    const products = view.fields.some(field => field.type === 'items' || field.type === 'invoiceItems')
      ? await api('/masters/products') : [];
    const fields = await Promise.all(view.fields.map(async field => {
      const required = field.required ? 'required' : '';
      const id = `entry-${field.key}`;
        const label = `<label class="form-label" for="${id}">${field.label}${field.required ? ' *' : ''}</label>`;
      if (field.type === 'items' || field.type === 'invoiceItems') {
        return `<div class="col-12"><label class="form-label">${field.label}</label><div class="line-items" data-lines="${field.type}"></div><button type="button" class="btn btn-sm btn-outline-success add-line" data-kind="${field.type}">+ Add line</button></div>`;
      }
      if (field.type === 'relation') {
        const records = await loadOperationOptions(field);
        return `<div class="col-md-6">${label}<select class="form-select" id="${id}" name="${field.key}" ${required}><option value="">${field.emptyLabel || 'Select…'}</option>${records.map(record => `<option value="${escapeHtml(record.id)}" ${field.filter === 'approved' || field.filter === 'invoice' || field.filter === 'invoiceOrder' ? `data-party="${escapeHtml(record.party_id)}"` : ''} ${record.party_type ? `data-party-type="${escapeHtml(record.party_type)}"` : ''} ${field.filter === 'invoice' ? `data-invoice-type="${escapeHtml(record.invoice_type)}" data-balance="${Math.max(0,Number(record.grand_total)-Number(record.allocated_amount||0))}"` : ''}>${escapeHtml(record.name || record.order_no || record.dispatch_no || record.invoice_no || record.full_name)}</option>`).join('')}</select></div>`;
      }
      if (field.type === 'select') {
        return `<div class="col-md-6">${label}<select class="form-select" id="${id}" name="${field.key}" ${required}>${field.options.map(option => `<option value="${option}">${stageLabel(option)}</option>`).join('')}</select></div>`;
      }
      if (field.type === 'textarea') return `<div class="col-12">${label}<textarea class="form-control" id="${id}" name="${field.key}" rows="3"></textarea></div>`;
      return `<div class="col-md-6">${label}<input class="form-control" id="${id}" name="${field.key}" type="${field.type}" ${field.min ? `min="${field.min}"` : ''} ${required} ${field.today && !existing ? `value="${new Date().toISOString().slice(0,10)}"` : ''}></div>`;
    }));
    if (!existing) fields.unshift(manualIdField('entry-record-id'));
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style = 'display:block;background:#10251b66';
    modal.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content"><form id="operationForm"><div class="modal-header"><h5 class="modal-title">${existing ? 'Edit' : 'New'} ${view.title} entry</h5><button type="button" class="btn-close" id="closeOperation"></button></div><div class="modal-body row g-3">${fields.join('')}<div class="col-12"><div class="form-feedback" id="operationError" role="alert"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" id="cancelOperation">Cancel</button><button class="btn btn-primary">${existing ? 'Save changes' : 'Save entry'}</button></div></form></div></div>`;
    document.body.append(modal);
    const lineContainer = modal.querySelector('.line-items');
    if (lineContainer) {
      const lineKind = page === 'invoices' ? 'invoiceItems' : page;
      const existingLines = existing?.items || [];
      if (existingLines.length) {
        existingLines.forEach(item => {
          const row = buildItemRow(lineKind, products);
          row.querySelector('.line-product').value = item.product_id || '';
          row.querySelector('.line-quantity').value = item.quantity ?? item.ordered_qty ?? '';
          row.querySelector('.line-rate').value = item.rate ?? '';
          if (row.querySelector('.line-discount')) row.querySelector('.line-discount').value = item.discount || 0;
          row.querySelector('.line-tax').value = item.tax_rate ?? '';
          lineContainer.append(row);
        });
      } else {
        lineContainer.append(buildItemRow(lineKind, products));
      }
      modal.querySelector('.add-line').onclick = () => lineContainer.append(buildItemRow(page === 'invoices' ? 'invoiceItems' : page, products));
    }
    if (existing) {
      for (const field of view.fields) {
        if (field.type === 'items' || field.type === 'invoiceItems') continue;
        const control = modal.querySelector(`[name="${field.key}"]`);
        const value = page === 'expenses' && field.key === 'category'
          ? existing.category_name
          : existing[field.key];
        if (!control || value === undefined || value === null) continue;
        control.value = field.type === 'date' ? String(value).slice(0, 10) : value;
      }
    }
    const close = () => modal.remove();
    $('#closeOperation').onclick = close;
    $('#cancelOperation').onclick = close;
    if (page === 'dispatch') {
      const orderSelect = modal.querySelector('[name="order_id"]');
      const partySelect = modal.querySelector('[name="party_id"]');
      orderSelect.onchange = () => {
        const partyId = orderSelect.selectedOptions[0].dataset.party;
        if (partyId) partySelect.value = partyId;
      };
    }
    if (page === 'payments') {
      const typeSelect = modal.querySelector('[name="payment_type"]');
      const partySelect = modal.querySelector('[name="party_id"]');
      const invoiceSelect = modal.querySelector('[name="allocation_invoice"]');
      const filterInvoices = () => {
        const wantedType = typeSelect.value === 'RECEIPT' ? 'SALE' : 'PURCHASE';
        [...invoiceSelect.options].forEach(option => {
          if (!option.value) return;
          option.hidden = option.dataset.invoiceType !== wantedType ||
            (partySelect.value && option.dataset.party !== partySelect.value);
        });
        if (invoiceSelect.selectedOptions[0]?.hidden) invoiceSelect.value = '';
      };
      typeSelect.onchange = filterInvoices;
      partySelect.onchange = filterInvoices;
      filterInvoices();
      invoiceSelect.onchange = () => {
        const allocation = modal.querySelector('[name="allocation_amount"]');
        if (invoiceSelect.value) {
          const invoice = invoiceSelect.selectedOptions[0];
          const due = Number(invoice.dataset.balance || 0);
          allocation.max = String(due);
          if (!allocation.value || Number(allocation.value) > due) allocation.value = String(due);
        } else {
          allocation.removeAttribute('max');
        }
      };
    }
    if (page === 'invoices') {
      const typeSelect = modal.querySelector('[name="invoice_type"]');
      const partySelect = modal.querySelector('[name="party_id"]');
      const orderSelect = modal.querySelector('[name="order_id"]');
      const filterParties = () => {
        const wanted = typeSelect.value === 'SALE' ? ['CUSTOMER','BOTH'] : ['SUPPLIER','BOTH'];
        [...partySelect.options].forEach(option => {
          if (!option.value) return;
          option.hidden = Boolean(option.dataset.partyType && !wanted.includes(option.dataset.partyType));
        });
        if (partySelect.selectedOptions[0]?.hidden) partySelect.value = '';
      };
      typeSelect.onchange = filterParties;
      filterParties();
      orderSelect.onchange = () => {
        if (!orderSelect.value) return;
        typeSelect.value = 'SALE';
        filterParties();
        partySelect.value = orderSelect.selectedOptions[0].dataset.party;
      };
    }
    $('#operationForm').onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      for (const [key, value] of Object.entries(data)) {
        if (value === '') delete data[key];
        else if (['amount','freight','loading_charges','unloading_charges','quantity','unit_cost'].includes(key)) data[key] = Number(value);
      }
      if (page === 'payments') {
        const invoiceId = data.allocation_invoice;
        const allocationAmount = Number(data.allocation_amount || 0);
        delete data.allocation_invoice;
        delete data.allocation_amount;
        data.allocations = invoiceId && allocationAmount ? [{ invoice_id:invoiceId,amount:allocationAmount }] : [];
      }
      const lineRows = lineContainer ? [...lineContainer.querySelectorAll('.line-item-row')] : [];
      if (lineContainer) {
        data.items = lineRows.map(row => {
          const item = {
            product_id:row.querySelector('.line-product').value || null,
            quantity:Number(row.querySelector('.line-quantity').value),
            rate:Number(row.querySelector('.line-rate').value)
          };
          if (page === 'invoices') item.description = row.querySelector('.line-description').value || row.querySelector('.line-product').selectedOptions[0]?.dataset.name || '';
          else item.discount = Number(row.querySelector('.line-discount').value || 0);
          const taxRate = row.querySelector('.line-tax').value;
          if (taxRate !== '') item.tax_rate = Number(taxRate);
          return item;
        }).filter(item => item.product_id || page === 'invoices');
        if (page === 'invoices') data.items.forEach(item => { if (!item.product_id) delete item.product_id; });
        if (page === 'dispatch') data.items = data.items.map(item => ({ product_id:item.product_id,quantity:item.quantity }));
      }
      try {
        await api(existing ? `${view.endpoint}/${existing.id}` : view.endpoint, {
          method: existing ? 'PUT' : 'POST',
          body: JSON.stringify(data)
        });
        close();
        await renderOperations(page);
      } catch (error) {
        $('#operationError').textContent = error.message;
      }
    };
  } catch (error) {
    alert(error.message);
  }
}

async function renderReports() {
  try {
    const report = await api('/operations/reports/summary');
    $('#content').innerHTML = `<div class="d-flex justify-content-between align-items-center gap-2 mb-3"><div><h2 class="h5 mb-1">Business Reports</h2><div class="panel-sub">Sales, purchase, receivables, payables and stock overview</div></div><button class="btn btn-outline-secondary" id="reportPdf">Print / Save PDF</button></div><div class="kpi-grid report-grid">${[
      ['Sales invoices',report.sales.count,money(report.sales.total),'invoices'],
      ['Purchase invoices',report.purchases.count,money(report.purchases.total),'invoices'],
      ['Receivables',money(report.receivables),'Open customer invoice balance','ledger'],
      ['Payables',money(report.payables),'Open supplier invoice balance','ledger'],
      ['Stock value',money(report.stockValue),'Based on recorded stock movement cost','stock']
    ].map(([label,value,note,page])=>`<button class="kpi kpi-button" data-open="${page}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></button>`).join('')}</div>`;
    $('#reportPdf').onclick = () => downloadRecordPdf('Business Reports', {
      sales_invoice_count: report.sales.count,
      sales_invoice_total: report.sales.total,
      purchase_invoice_count: report.purchases.count,
      purchase_invoice_total: report.purchases.total,
      receivables: report.receivables,
      payables: report.payables,
      stock_value: report.stockValue
    });
    document.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>showPage(button.dataset.open));
  } catch (error) {
    $('#content').innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function renderSettings() {
  try {
    const [company,warehouses] = await Promise.all([api('/operations/settings'),api('/operations/warehouses')]);
    const warehouseRows = warehouses.map(warehouse => {
      const permission = { editable: true, deletable: !warehouse.has_movements && warehouses.length > 1 };
      return `<tr class="record-clickable" tabindex="0" data-record-id="${escapeHtml(warehouse.id)}"><td>${escapeHtml(warehouse.name)}</td><td>${warehouse.has_movements ? 'Has stock history' : 'No stock history'}</td><td>${renderRecordActions(warehouse, permission)}</td></tr>`;
    }).join('');
    $('#content').innerHTML = `<div class="d-flex justify-content-between align-items-center gap-2"><div><h2 class="h5 mb-1">Company Settings</h2><div class="panel-sub">Company profile and GST configuration</div></div><button type="button" class="btn btn-outline-secondary" id="companyPdf">Print / Save PDF</button></div><div class="panel"><form id="companySettings" class="row g-3"><div class="col-md-6"><label class="form-label">Company name</label><input class="form-control" name="name" required maxlength="180" value="${escapeHtml(company.name)}"></div><div class="col-md-6"><label class="form-label">Legal name</label><input class="form-control" name="legal_name" maxlength="220" value="${escapeHtml(company.legal_name || '')}"></div><div class="col-md-6"><label class="form-label">GSTIN</label><input class="form-control uppercase-field" name="gstin" maxlength="15" placeholder="Up to 15 characters" value="${escapeHtml(company.gstin || '')}"></div><div class="col-md-6"><label class="form-label">GST registered</label><select class="form-select" name="gst_registered"><option value="true" ${company.gst_registered ? 'selected' : ''}>Yes</option><option value="false" ${!company.gst_registered ? 'selected' : ''}>No</option></select></div><div class="col-md-6"><label class="form-label">GST state</label><input class="form-control" name="gst_state" maxlength="100" value="${escapeHtml(company.gst_state || '')}"></div><div class="col-md-6"><label class="form-label">Email</label><input class="form-control" type="email" name="email" maxlength="180" value="${escapeHtml(company.email || '')}"></div><div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" name="phone" maxlength="30" value="${escapeHtml(company.phone || '')}"></div><div class="col-12"><label class="form-label">Address</label><textarea class="form-control" name="address" maxlength="4000" rows="2">${escapeHtml(company.address || '')}</textarea></div><div class="col-12"><div class="form-feedback" id="settingsError" role="alert"></div></div><div class="col-12"><button class="btn btn-primary">Save company settings</button></div></form></div><div class="panel"><div class="d-flex justify-content-between align-items-center gap-2 mb-2"><div><div class="panel-title">Warehouses</div><div class="panel-sub">Only warehouses without stock history can be deleted</div></div><button class="btn btn-sm btn-outline-success" id="settingsWarehouse">+ Add warehouse</button></div><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr><th>Name</th><th>History</th><th>Actions</th></tr></thead><tbody>${warehouseRows || '<tr><td colspan="3" class="empty-state">No warehouses configured.</td></tr>'}</tbody></table></div></div><div class="panel"><div class="panel-title">Team</div><div class="panel-sub">Sales team employee directory only. User invitations and access roles are not enabled yet.</div><button class="btn btn-sm btn-outline-success mt-2" id="openTeam">Manage sales team</button></div>`;
    $('#companyPdf').onclick = () => downloadRecordPdf('Company Profile', company);
    $('#content').querySelectorAll('.uppercase-field').forEach(input => {
      input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
    });
    $('#companySettings').onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      data.gst_registered = data.gst_registered === 'true';
      for (const key of Object.keys(data)) if (data[key] === '') data[key] = null;
      try {
        const updated = await api('/operations/settings',{method:'PATCH',body:JSON.stringify(data)});
        session.companies = session.companies.map(item=>item.id===updated.id?{...item,name:updated.name}:item);
        $('#companySelect').selectedOptions[0].textContent=updated.name;
        alert('Company settings saved.');
      } catch(error) {
        $('#settingsError').textContent=error.message;
      }
    };
    $('#settingsWarehouse').onclick=() => openWarehouseForm(null, () => renderSettings());
    wireRecordActions($('#content'), warehouses, {
      title: 'Warehouse',
      endpoint: '/operations/warehouses',
      labelField: 'name',
      canChange: warehouse => ({
        editable: true,
        deletable: !warehouse.has_movements && warehouses.length > 1
      }),
      lockMessage: warehouse => warehouse.has_movements
        ? 'A warehouse with stock history cannot be deleted.'
        : warehouses.length === 1 ? 'The company must keep at least one warehouse.' : '',
      onEdit: warehouse => openWarehouseForm(warehouse, () => renderSettings()),
      reload: () => renderSettings()
    });
    $('#openTeam').onclick=()=>showPage('team');
  } catch(error) {
    $('#content').innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}
