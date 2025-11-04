// routes/admin_ecpay.js
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const { sendApi } = require('../services/ecpay');

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post('/ecpay/retry', async (req, res) => {
  try {
    const order = req.body.order;
    if (!order) return res.status(400).json({ error: 'missing order in body' });

    const payload = {
      MerchantID: process.env.ECPAY_MERCHANT_ID,
      RelateNumber: order.relateNumber || ('REL' + Date.now()),
      CustomerIdentifier: order.customerIdentifier || '',
      CustomerName: order.customerName || '買受人',
      CustomerAddr: order.customerAddr || '',
      Print: order.print || '0',
      Donation: order.donation || '0',
      CarrierType: order.carrierType || '',
      TaxType: order.taxType || '1',
      SalesAmount: order.salesAmount || 0,
      TaxAmount: order.taxAmount || 0,
      InvType: order.invType || '07',
      vat: order.vat || '1',
      Items: order.items || []
    };

    const json = await sendApi('/Issue', payload, true);
    res.json({ ok: true, result: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: String(err) });
  }
});

router.post('/ecpay/notify', bodyParser.urlencoded({ extended: false }), (req, res) => {
  console.log('ECPay notify (admin route):', req.body);
  res.set('Content-Type', 'text/plain');
  res.send('1|OK');
});

module.exports = router;
