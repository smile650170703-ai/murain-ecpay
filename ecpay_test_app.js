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
// <- paste near other app.get/post routes in ecpay_test_app.js
// 使用 bodyParser 已在檔案最上方載入：app.use(bodyParser.urlencoded(...)); app.use(bodyParser.json());
/**
 * POST /debug/decrypt
 * Body JSON: { "Data": "<base64-encrypted-Data-from-ecpay-response>" }
 * 注意：此端點僅用於內部測試，務必不要公開在 production public 網域。
 */
app.post('/debug/decrypt', bodyParser.json(), (req, res) => {
  try {
    const { Data } = req.body || {};
    if (!Data) return res.status(400).json({ error: 'Missing Data in request body' });

    // 我們從 real implementation (ecpay.original.js) 直接使用 decrypt helper
    // 如果 production 環境是真實 sendApi 實作，請把 decryptThenUrldecode 改為透過 services/ecpay export
    let decryptFn;
    try {
      decryptFn = require('./services/ecpay.original').decryptThenUrldecode;
    } catch (e) {
      return res.status(500).json({ error: 'decrypt helper not available: ' + String(e.message) });
    }

    const key = process.env.ECPAY_HASH_KEY || '';
    const iv = process.env.ECPAY_HASH_IV || '';
    const decoded = decryptFn(Data, key, iv);
    res.json({ ok: true, decoded });
  } catch (err) {
    console.error('debug/decrypt error', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /run/issue_b2c
 * 範例：發送上面 payload（JSON）到 ECPay（透過 services/ecpay 的 sendApi）
 * 回傳 ECPay 原始回應 (res.data)
 */
app.post('/run/issue_b2c', async (req, res) => {
  try {
    // 如果沒有 body 就使用內建的測試 payload（方便用 GET 測試）
    const payload = req.body && Object.keys(req.body).length ? req.body : {
      RelateNumber: 'REL-TEST-001-' + Date.now(),
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
      Items: [{
        ItemSeq: 1, ItemName: '測試商品A', ItemCount: 1, ItemWord: '件', ItemPrice: 95, ItemTaxType: '1', ItemAmount: 95
      }],
      CustomerEmail: 'test@example.com',
      CustomerPhone: ''
    };

    // sendApi 來自 services/ecpay (wrapper or real)
    const result = await sendApi('/Issue', payload, true);
    res.json(result);
  } catch (err) {
    console.error('issue_b2c error:', err);
    res.status(500).send(String(err.message || err));
  }
});

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
/**
 * POST /debug/decrypt
 * Body JSON: { "Data": "<base64-encrypted-Data-from-ecpay-response>" }
 * 僅作內部測試，請勿公開到 production public 網域
 */
app.post('/debug/decrypt', bodyParser.json(), (req, res) => {
  try {
    const { Data } = req.body || {};
    if (!Data) return res.status(400).json({ error: 'Missing Data in request body' });

    // 載入 service（ecpay.original.js）嘗試使用 decryptThenUrldecode，
    // 如無則 fallback 到 aesDecrypt 並嘗試 JSON.parse
    let svc;
    try {
      svc = require('./services/ecpay.original');
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load services/ecpay.original: ' + String(e.message) });
    }

    const key = process.env.ECPAY_HASH_KEY || '';
    const iv  = process.env.ECPAY_HASH_IV || '';

    let decoded;
    if (svc && typeof svc.decryptThenUrldecode === 'function') {
      // 如果你在 services 有實作 decryptThenUrldecode 就用它
      decoded = svc.decryptThenUrldecode(Data, key, iv);
    } else if (svc && typeof svc.aesDecrypt === 'function') {
      // 否則用 aesDecrypt 作 base64->utf8，並嘗試 parse JSON（若不是 json 就回字串）
      const plain = svc.aesDecrypt(Data, key, iv);
      try { decoded = JSON.parse(plain); } catch (_) { decoded = plain; }
    } else {
      return res.status(500).json({ error: 'No decrypt function found in services/ecpay.original.js' });
    }

    res.json({ ok: true, decoded });
  } catch (err) {
    console.error('/debug/decrypt error', err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});
