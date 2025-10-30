require('dotenv').config();

module.exports = {
  circle: {
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  },
  network: {
    name: process.env.NETWORK || 'ARC-TESTNET',
    usdcAddress: process.env.USDC_TOKEN_ADDRESS || '0x3600000000000000000000000000000000000000',
    usdcTokenId: process.env.USDC_TOKEN_ID || '15dc2b5d-0994-58b0-bf8c-3a0501148ee8',
  },
};