// services/ecpay.original.js
// AES helper + decrypt helper + CheckMacValue + sendApi (ECPay 正式 payload 範例)
// 注意：請在 .env 設定 ECPAY_API_URL, ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV

const crypto = require('crypto');
const axios = require('axios');

/* ------------------ AES helpers ------------------ */
function normalizeKeyIv(keyStr, ivStr) {
  const k = (keyStr || '').toString().trim();
  const iv = (ivStr || '').toString().trim();
  const looksLikeHex = s => /^[0-9a-fA-F]+$/.test(s) && (s.length % 2 === 0);
  const keyBuf = looksLikeHex(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'utf8');
  const ivBuf  = looksLikeHex(iv) ? Buffer.from(iv, 'hex')  : Buffer.from(iv, 'utf8');
  return { keyBuf, ivBuf, rawKey: k, rawIv: iv };
}

function getAlgorithmForKeyBuffer(keyBuf) {
  if (keyBuf.length === 16) return 'aes-128-cbc';
  if (keyBuf.length === 24) return 'aes-192-cbc';
  if (keyBuf.length === 32) return 'aes-256-cbc';
  throw new Error('Unsupported key length: ' + keyBuf.length);
}

function aesEncrypt(plainText, keyStr, ivStr) {
  const { keyBuf, ivBuf } = normalizeKeyIv(keyStr, ivStr);
  if (!keyBuf || !ivBuf) throw new Error('Missing key or iv for AES encryption');
  const alg = getAlgorithmForKeyBuffer(keyBuf);
  const cipher = crypto.createCipheriv(alg, keyBuf, ivBuf);
  let out = cipher.update(String(plainText), 'utf8', 'base64');
  out += cipher.final('base64');
  return out;
}

function aesDecrypt(base64Text, keyStr, ivStr) {
  const { keyBuf, ivBuf } = normalizeKeyIv(keyStr, ivStr);
  const alg = getAlgorithmForKeyBuffer(keyBuf);
  const decipher = crypto.createDecipheriv(alg, keyBuf, ivBuf);
  let out = decipher.update(String(base64Text), 'base64', 'utf8');
  out += decipher.final('utf8');
  return out;
}

/* decryptThenUrldecode: ECPay 回傳若為 URL-encoded query string 的處理器 */
function decryptThenUrldecode(base64Text, keyStr, ivStr) {
  const decrypted = aesDecrypt(base64Text, keyStr, ivStr);
  try {
    const decoded = decodeURIComponent(decrypted);
    const pairs = {};
    if (decoded.includes('=')) {
      decoded.split('&').forEach(part => {
        const [k, v] = part.split('=');
        if (k) pairs[k] = v === undefined ? '' : v;
      });
    }
    return { raw: decrypted, decoded, parsed: pairs };
  } catch (e) {
    return { raw: decrypted };
  }
}

/* ------------------ CheckMacValue (ECPay 規則) ------------------ */
/*
  Steps (per ECPay doc):
    1) 參數依照 key A->Z 排序並以 & 串接 (key=value&...)
    2) 在前面加 HashKey=xxx& 並於尾端加 &HashIV=yyy
    3) URL encode 全串，然後轉小寫
    4) MD5 -> 再轉大寫 -> 得到 CheckMacValue
  注意：不同語言的 urlencode 需對照 ECPay 的轉換表（下例做常見替換）
*/
function urlEncodeForEcpay(str) {
  // 基本 encodeURIComponent，再做 ECPay 指示的替換（參考官方附錄）
  let s = encodeURIComponent(str);
  // 一些語言會把特定符號 encode 成 %2d 等，官方建議做替換以符合規格
  // 依官方示例：將 %2d -> -, %5f -> _, %2e -> ., %21 -> !, %2a -> *, %28 -> (, %29 -> )
  s = s.replace(/%2d/ig, '-')
       .replace(/%5f/ig, '_')
       .replace(/%2e/ig, '.')
       .replace(/%21/ig, '!')
       .replace(/%2a/ig, '*')
       .replace(/%28/ig, '(')
       .replace(/%29/ig, ')');
  return s;
}

function generateCheckMacValue(params = {}, HashKey = '', HashIV = '') {
  // 1) sort keys A..Z
  const sortedKeys = Object.keys(params).sort((a,b) => a.localeCompare(b));
  const kv = sortedKeys.map(k => `${k}=${params[k] === undefined ? '' : String(params[k])}`).join('&');
  // 2) prefix/suffix HashKey / HashIV
  const raw = `HashKey=${HashKey}&${kv}&HashIV=${HashIV}`;
  // 3) URL encode then toLowerCase (use ecpay-specific encode)
  const encoded = urlEncodeForEcpay(raw).toLowerCase();
  // 4) md5 -> uppercase
  const hash = crypto.createHash('md5').update(encoded).digest('hex').toUpperCase();
  return hash;
}

/* ------------------ sendApi: ECPay 正式 POST helper ------------------ */
/**
 * sendApi(path, data, useTest=false)
 * - path: 例如 '/Issue' (ECPay 文件指定的 endpoint path)
 * - data: object (將被 JSON.stringify 後以 AES 加密，做為 PostData)
 * - 會送出 x-www-form-urlencoded: MerchantID, PostData, TestMode?, CheckMacValue
 *
 * 環境變數 (放 .env 或在平台 env 設定):
 *   ECPAY_API_URL    (例: https://einvoice.ecpay.com.tw 或 測試端)
 *   ECPAY_MERCHANT_ID
 *   ECPAY_HASH_KEY
 *   ECPAY_HASH_IV
 */
async function sendApi(path, data = {}, useTest = false) {
  const urlBase = (process.env.ECPAY_API_URL || '').replace(/\/$/, '');
  const merchant = process.env.ECPAY_MERCHANT_ID || '';
  const key = process.env.ECPAY_HASH_KEY || '';
  const iv = process.env.ECPAY_HASH_IV || '';

  if (!urlBase) throw new Error('ECPAY_API_URL not set in environment');
  if (!merchant) throw new Error('ECPAY_MERCHANT_ID not set in environment');
  if (!key || !iv) throw new Error('ECPAY_HASH_KEY / ECPAY_HASH_IV not set in environment');

  // 1) 加密 data -> base64
  const plain = JSON.stringify(data || {});
  const encrypted = aesEncrypt(plain, key, iv); // base64

  // 2) 建立表單欄位 (以 ECPay 一般做法：MerchantID + PostData)，若官方另有指定欄位請依其規格調整
  const params = {
    MerchantID: merchant,
    PostData: encrypted
  };
  if (useTest) params.TestMode = 1;

  // 3) 產生 CheckMacValue （官方要求要把要送的參數也納入檢查）
  const check = generateCheckMacValue(params, key, iv);
  params.CheckMacValue = check;

  // 4) 使用 x-www-form-urlencoded 發 POST
  const form = new URLSearchParams();
  Object.keys(params).forEach(k => form.append(k, String(params[k])));

  const url = urlBase + path;
  const res = await axios.post(url, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });

  return res.data;
}

/* 最後 exports：確保匯出所有 helper（讓你的 debug endpoint 可以用） */
module.exports = {
  aesEncrypt,
  aesDecrypt,
  decryptThenUrldecode,
  generateCheckMacValue,
  sendApi
};
