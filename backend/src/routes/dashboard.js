const router=require('express').Router(); const db=require('../db');
router.get('/',async(req,res,next)=>{try{
 const id=req.companyId;
 const [orders,sales,payments,parties,products,pending,dispatch]=await Promise.all([
  db.query("SELECT COUNT(*)::int count FROM sales_orders WHERE company_id=$1 AND order_date>=date_trunc('month',CURRENT_DATE)",[id]),
  db.query("SELECT COALESCE(SUM(grand_total),0) total FROM invoices WHERE company_id=$1 AND invoice_type='SALE' AND invoice_date>=date_trunc('month',CURRENT_DATE)",[id]),
  db.query("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE company_id=$1 AND payment_type='RECEIPT' AND payment_date>=date_trunc('month',CURRENT_DATE)",[id]),
  db.query('SELECT COUNT(*)::int count FROM parties WHERE company_id=$1 AND is_active=true',[id]),
  db.query('SELECT COUNT(*)::int count FROM products WHERE company_id=$1 AND is_active=true',[id]),
  db.query("SELECT COUNT(*)::int count FROM sales_orders WHERE company_id=$1 AND status IN ('SUBMITTED','APPROVED','PARTIAL')",[id]),
  db.query("SELECT COUNT(*)::int count FROM dispatches WHERE company_id=$1 AND dispatch_date>=date_trunc('month',CURRENT_DATE)",[id])
 ]);
 res.json({monthOrders:orders.rows[0].count,monthSales:Number(sales.rows[0].total),monthCollections:Number(payments.rows[0].total),parties:parties.rows[0].count,products:products.rows[0].count,pendingOrders:pending.rows[0].count,monthDispatches:dispatch.rows[0].count});
 }catch(e){next(e)}});
module.exports=router;
