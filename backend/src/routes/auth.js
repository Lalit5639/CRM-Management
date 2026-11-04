const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');

const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(180),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(180),
  password: z.string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number')
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

function createToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

router.post('/signup', async (req, res, next) => {
  let client;
  try {
    const input = signupSchema.parse(req.body);
    client = await db.pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [input.email]);

    const existing = await client.query(
      'SELECT id FROM users WHERE lower(email)=lower($1)',
      [input.email]
    );
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const userResult = await client.query(
      `INSERT INTO users(full_name,email,password_hash)
       VALUES($1,$2,$3) RETURNING id,full_name,email`,
      [input.name, input.email, passwordHash]
    );
    const user = userResult.rows[0];
    const companyResult = await client.query(
      'INSERT INTO companies(name,legal_name,email) VALUES($1,$1,$2) RETURNING id,name',
      [input.companyName, input.email]
    );
    const company = companyResult.rows[0];
    const roleResult = await client.query(
      `INSERT INTO roles(company_id,name,description)
       VALUES($1,'Owner','Company owner with full workspace access') RETURNING id`,
      [company.id]
    );
    await client.query(
      `INSERT INTO user_companies(user_id,company_id,role_id,is_default)
       VALUES($1,$2,$3,TRUE)`,
      [user.id, company.id, roleResult.rows[0].id]
    );
    await client.query(
      'INSERT INTO warehouses(company_id,name) VALUES($1,$2)',
      [company.id,'Main Warehouse']
    );

    const token = createToken(user);
    await client.query('COMMIT');
    res.status(201).json({
      token,
      user: { id: user.id, name: user.full_name, email: user.email },
      companies: [{ id: company.id, name: company.name, role_id: roleResult.rows[0].id, is_default: true }]
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to roll back company signup transaction:', rollbackError);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await db.query(
      'SELECT id,full_name,email,password_hash,is_active FROM users WHERE lower(email)=lower($1)',
      [input.email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(input.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const companies = await db.query(
      `SELECT c.id,c.name,uc.role_id,uc.is_default
       FROM user_companies uc
       JOIN companies c ON c.id=uc.company_id
       WHERE uc.user_id=$1 AND c.is_active=TRUE
       ORDER BY uc.is_default DESC,c.name`,
      [user.id]
    );
    res.json({
      token: createToken(user),
      user: { id: user.id, name: user.full_name, email: user.email },
      companies: companies.rows
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
