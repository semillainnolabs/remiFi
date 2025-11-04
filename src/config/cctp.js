const CCTP_CONFIG = {
  domains: {
    "ARC-TESTNET": 26,
    "ETH-SEPOLIA": 0,
    "AVAX-FUJI": 1,
    "ARB-SEPOLIA": 3,
    "BASE-SEPOLIA": 6,
    "MATIC-AMOY": 7,
  },
  contracts: {
    "ARC-TESTNET": {
      tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      messageTransmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
      tokenMinter: "0xb43db544e2c27092c107639ad201b3defabcf192",
      usdc: "0x3600000000000000000000000000000000000000",
    },
    "ETH-SEPOLIA": {
      tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      messageTransmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
      tokenMinter: "0xb43db544e2c27092c107639ad201b3defabcf192",
      usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    },
    "AVAX-FUJI": {
      tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      messageTransmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
      tokenMinter: "0xb43db544e2c27092c107639ad201b3defabcf192",
      usdc: "0x5425890298aed601595a70ab815c96711a31bc65",
    },
    "ARB-SEPOLIA": {
      tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      messageTransmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
      tokenMinter: "0xb43db544e2c27092c107639ad201b3defabcf192",
      usdc: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    },
    "BASE-SEPOLIA": {
      tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      messageTransmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
      tokenMinter: "0xb43db544e2c27092c107639ad201b3defabcf192",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7c",
    },
  },
};

module.exports = CCTP_CONFIG;
