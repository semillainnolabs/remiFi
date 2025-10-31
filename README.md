# RemiFi Bot

An AI Agent for helping U.S. immigrants to make cross border payments and fund their families wallets back home.

## Features

- **Create SCA Wallets**: Seamlessly create SCA wallets on multiple blockchains.
- **View Wallet Address and ID**: Easily retrieve your wallet address and unique wallet ID.
- **Check USDC Balance**: Monitor your wallet balance specifically for USDC.
- **Send USDC**: Execute transactions to send USDC to any address.
- **Secure Credential Storage**: Protect sensitive credentials using secure storage practices.

## Prerequisites

- Node.js v16 or higher
- Circle API Key and Entity Secret (Get started at [Circle Developer Console](https://console.circle.com))
- Telegram Bot Token (obtain from [@BotFather](https://t.me/BotFather))

## Installation

1. Clone the repository:

```bash
git clone https://github.com/semillainnolabs/remifi.git
cd remifi
```

2. Install dependencies:

```bash
npm install
```

3. Add your secrets to Replit's Secret Manager or set them as environment variables:

```bash
cp .env.sample .env
```

4. Configure your environment variables in the .env file:
- CIRCLE_API_KEY=your_circle_api_key_here
- CIRCLE_ENTITY_SECRET=your_circle_entity_secret_here
- TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

5. Run server

```bash
npm run dev
```

## Supported Networks 

### Mainnet Networks
- Arc (ARC-TESTNET)
- Base (BASE)

### Testnet Networks
- Arc (ARC-TESTNET)
- Base Sepolia (BASE-SEPOLIA)

## Network Configurations

The bot supports multiple networks with their respective USDC contract addresses and token IDs. All network configurations are stored in `data/networks.json`.

### Structure
```json
{
  "NETWORK_NAME": {
    "name": "NETWORK_NAME",
    "usdcAddress": "USDC_CONTRACT_ADDRESS",
    "usdcTokenId": "CIRCLE_USDC_TOKEN_ID",
    "isTestnet": boolean
  }
}
```

### Each network entry contains:
- USDC smart contract address
- Circle's USDC token ID
- Network type (mainnet/testnet)

You can configure your preferred network in the .env file:

```bash
NETWORK=ARC-TESTNET
USDC_TOKEN_ADDRESS=0x3600000000000000000000000000000000000000
USDC_TOKEN_ID=15dc2b5d-0994-58b0-bf8c-3a0501148ee8
```

## Getting Testnet Tokens
To obtain testnet USDC for testing:

- Visit the [Circle Faucet](https://faucet.circle.com/)
- Connect your wallet
- Select the desired testnet network
- Request testnet USDC

## For native tokens (ETH), use the respective network faucets:

- [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)