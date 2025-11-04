// ecpay_test_app.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { sendApi } = require('./services/ecpay');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

function sampleIssue() {
  return {
    MerchantID: process.env.ECPAY_MERCHANT_ID || '2000132',
    RelateNumber: 'REL' + Date.now(),
    CustomerIdentifier: '',
    CustomerName: '測試買家',
    CustomerAddr: '台北市中正區XX路',
    Print: '1',
    Donation: '0',
    CarrierType: '',
    TaxType: '1',
    SalesAmount: 100,
    TaxAmount: 5,
    InvType: '07',
    vat: '1',
    Items: [
      { ItemSeq: 1, ItemName: '測試商品', ItemCount: 1, ItemWord: '件', ItemPrice: 95, ItemTaxType: '1', ItemAmount: 95 }
    ],
    CustomerEmail: 'test@example.com',
    CustomerPhone: ''
  };
}

function ensureBuyerContact(data, query) {
  if (query && query.email) data.CustomerEmail = query.email;
  if (query && query.phone) data.CustomerPhone = query.phone;
  if ((!data.CustomerEmail || data.CustomerEmail === '') && (!data.CustomerPhone || data.CustomerPhone === '')) {
    data.CustomerEmail = 'test@example.com';
  }
  return data;
}

app.get('/run/issue', async (req, res) => {
  try {
    let data = sampleIssue();
    data = ensureBuyerContact(data, req.query);
    const json = await sendApi('/Issue', data, true);
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message || String(err));
  }
});

app.post('/notify', bodyParser.urlencoded({ extended: false }), (req, res) => {
  console.log('ECPay notify (raw):', req.body);
  res.set('Content-Type', 'text/plain');
  res.send('1|OK');
});

app.listen(PORT, () => {
  console.log('ECPay test app listening on port', PORT);
  console.log('Open: http://localhost:' + PORT + '/run/issue?email=test@example.com');
});
