/**
 * Wrapper for services/ecpay (FOR LOCAL TESTING)
 * - If ECPAY keys are placeholders or missing -> return dummy response
 * - If keys exist and services/ecpay.original.js exists -> delegate to it
 */
let real = null;
try {
  real = require('./ecpay.original');
} catch (e) {
  real = null;
}

async function sendApi(path, data, useTest = false) {
  const key = process.env.ECPAY_HASH_KEY || '';
  const iv = process.env.ECPAY_HASH_IV || '';
  const merchant = process.env.ECPAY_MERCHANT_ID || '';
  if (!key || !iv || !merchant || key.includes('<YOUR') || iv.includes('<YOUR') || merchant.includes('<YOUR')) {
    console.warn('[ecpay wrapper] ECPay keys missing or placeholder — returning dummy response for local testing');
    return {
      ok: true,
      message: 'dummy response (ECPAY keys not set)',
      path,
      data,
      useTest
    };
  }
  if (real && typeof real.sendApi === 'function') {
    return real.sendApi(path, data, useTest);
  }
  throw new Error('ECPay real implementation not found but keys present');
}

module.exports = { sendApi };