const db = require('../db');
module.exports = async function companyContext(req, res, next) {
  try {
    const companyId = req.headers['x-company-id'];
    if (!companyId) return res.status(400).json({ error: 'Select a company first (X-Company-Id header required)' });
    const result = await db.query(
      `SELECT uc.company_id, uc.role_id FROM user_companies uc JOIN companies c ON c.id=uc.company_id
       WHERE uc.user_id=$1 AND uc.company_id=$2 AND c.is_active=TRUE`, [req.user.sub, companyId]);
    if (!result.rowCount) return res.status(403).json({ error: 'You do not have access to this company' });
    req.companyId = result.rows[0].company_id; req.roleId = result.rows[0].role_id; next();
  } catch (e) { next(e); }
};
