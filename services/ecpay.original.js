// services/ecpay.js
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV;
const BASE_URL = process.env.ECPAY_BASE_URL || 'https://einvoice-stage.ecpay.com.tw';

function aesEncrypt(plain) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(HASH_KEY || '' , 'utf8'), Buffer.from(HASH_IV || '', 'utf8'));
  let encrypted = cipher.update(plain, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function aesDecrypt(encryptedBase64) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(HASH_KEY || '', 'utf8'), Buffer.from(HASH_IV || '', 'utf8'));
  let decoded = decipher.update(encryptedBase64, 'base64', 'utf8');
  decoded += decipher.final('utf8');
  return decoded;
}

function buildRequestPayload(path, params) {
  const raw = JSON.stringify(params);
  const data = encodeURIComponent(aesEncrypt(raw));
  const payload = {
    MerchantID_: MERCHANT_ID,
    PostData_: data
  };
  return payload;
}

async function sendApi(path, params = {}, isIssue = false) {
  const url = BASE_URL + path;
  const payloadObj = Object.assign({}, params);
  const requestPayload = buildRequestPayload(path, payloadObj);
  const body = qs.stringify(requestPayload);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const resp = await axios.post(url, body, { headers, timeout: 15000 });
  try {
    const text = resp.data;
    const parsed = typeof text === 'string' ? qs.parse(text) : text;
    if (parsed.PostData_) {
      const decrypted = aesDecrypt(parsed.PostData_);
      try {
        return JSON.parse(decrypted);
      } catch (e) {
        return { raw: decrypted };
      }
    }
    return parsed;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  aesEncrypt,
  aesDecrypt,
  buildRequestPayload,
  sendApi
};
