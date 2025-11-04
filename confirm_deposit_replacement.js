/* ===== REPLACE the entire existing '/admin/confirm-deposit' handler with this block =====
   Locate in src/index.js the block that begins with:
     if (url.pathname === '/admin/confirm-deposit') {
   and replace that whole if-block (until its closing brace) with the code below.
   This version updates order status immediately and then fires an async, non-blocking
   attempt to issue invoice via services/ecpay.js -> issueInvoiceForOrder(env, orderForInvoice)
*/

if (url.pathname === '/admin/confirm-deposit') {
  const { order_id } = body;
  if (!order_id) return j({ error: 'order_id required' }, 400);

  const ord = await d1FindOrderByOrderId(env.DB, order_id);
  if (!ord) return j({ error: 'order not found' }, 404);
  if (ord.status !== 'awaiting_deposit_proof') { return j({ error: 'Order status is not awaiting_deposit_proof' }, 400); }

  // update order status for the main flow (critical)
  await env.DB.prepare("UPDATE Orders SET status = 'awaiting_cod_shipment' WHERE order_id = ?1").bind(order_id).run();

  // Fire-and-forget invoice issuance (do NOT block main response)
  (async () => {
    try {
      // Fetch items for the order
      const items = await d1List(env.DB, 'OrderItems', { where: 'order_id = ?1', bind: [order_id] });
      if (!items || items.length === 0) {
        // Nothing to invoice - record and exit
        await env.DB.prepare("UPDATE Orders SET invoice_status = 'skipped', invoice_response = ?1 WHERE order_id = ?2")
          .bind('no items for invoice', order_id).run();
        return;
      }
      // Calculate amounts and build the payload expected by issueInvoiceForOrder(env, orderForInvoice)
      const totalAmount = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
      const taxAmount = ord.tax_amount || 0;

      const shippingInfo = (() => {
        try { return JSON.parse(ord.shipping_info || '{}'); } catch (e) { return {}; }
      })();

      const orderForInvoice = {
        relateNumber: ord.order_id,
        customerName: (ord.customer_name || ord.name || shippingInfo.name || '客戶').slice(0,60),
        customerAddr: (ord.customer_addr || ord.address || shippingInfo.address || '').slice(0,200),
        customerEmail: ord.customer_email || ord.customerEmail || shippingInfo.email || '',
        customerPhone: ord.customer_phone || ord.customerPhone || shippingInfo.phone || '',
        salesAmount: Math.round(totalAmount),
        taxAmount: Math.round(taxAmount || 0),
        items: items.map((it, idx) => ({
          ItemSeq: idx + 1,
          ItemName: (it.name || it.sku || '商品').slice(0,50),
          ItemCount: Number(it.qty || 1),
          ItemWord: '件',
          ItemPrice: Math.round(it.unit_price_final || it.unit_price || 0),
          ItemTaxType: '1',
          ItemAmount: Math.round(it.subtotal || 0)
        }))
      };

      // Call centralized service - ensure you imported it at top: import { issueInvoiceForOrder } from './services/ecpay';
      const ecResult = await issueInvoiceForOrder(env, orderForInvoice);
      console.log('[ECPAY] issue result:', order_id, ecResult);

      if (ecResult && (ecResult.RtnCode === '1' || Number(ecResult.RtnCode) === 1)) {
        const invNo = ecResult.InvoiceNumber || ecResult.InvoiceNo || ecResult.Invoice || '';
        await env.DB.prepare("UPDATE Orders SET invoice_status = 'issued', invoice_no = ?1, invoice_response = ?2 WHERE order_id = ?3")
          .bind(invNo, JSON.stringify(ecResult), order_id).run();
        console.log('[ECPAY] Invoice issued', order_id, invNo);
      } else {
        await env.DB.prepare("UPDATE Orders SET invoice_status = 'failed', invoice_response = ?1 WHERE order_id = ?2")
          .bind(JSON.stringify(ecResult || {}), order_id).run();
        console.error('[ECPAY] Issue failed', order_id, ecResult);
      }
    } catch (err) {
      console.error('[ECPAY_ERROR] async issue invoice error', err);
      try {
        await env.DB.prepare("UPDATE Orders SET invoice_status = 'error', invoice_response = ?1 WHERE order_id = ?2")
          .bind(String(err.message || err).slice(0,200), order_id).run();
      } catch (e) {
        console.error('[ECPAY_ERROR] failed to write invoice error to DB', e);
      }
    }
  })();

  // Return immediately to the admin client
  return j({ ok: true, order_id: order_id, status: 'awaiting_cod_shipment' });
}
