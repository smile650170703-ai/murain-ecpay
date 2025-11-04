const real = require('./ecpay.original');

async function sendApi(path, data, useTest = false){
  if (!real || typeof real.sendApi !== 'function') {
    throw new Error('ECPay real implementation not found');
  }
  return real.sendApi(path, data, useTest);
}

module.exports = { sendApi };
