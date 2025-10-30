const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  initiateDeveloperControlledWalletsClient,
} = require("@circle-fin/developer-controlled-wallets");
const config = require("../config/index.js");
const networkService = require("./networkService");
const CCTP = require("../config/cctp.js");

/**
 * CircleService class handles all Circle API interactions including wallet management,
 * transactions, and cross-chain transfers.
 */
class CircleService {
  /**
   * Initialize CircleService with required configurations
   * @param {TelegramBot} bot - Telegram bot instance for sending updates
   */
  constructor(bot) {
    if (!config?.circle?.apiKey || !config?.circle?.entitySecret) {
      throw new Error("Circle API key or entity secret is missing");
    }
    this.walletSDK = null;
    this.bot = bot;
  }

  /**
   * Initialize Circle Wallet SDK
   * @returns {Promise<Object>} Initialized SDK instance
   */
  async init() {
    try {
      if (!this.walletSDK) {
        console.log("Initializing Circle Wallet SDK...");

        this.walletSDK = initiateDeveloperControlledWalletsClient({
          apiKey: config.circle.apiKey,
          entitySecret: config.circle.entitySecret,
        });
        console.log("Circle Wallet SDK initialized");
      }
      return this.walletSDK;
    } catch (error) {
      console.error("Error initializing Circle SDK:", error);
      throw new Error("Failed to initialize Circle SDK: " + error.message);
    }
  }

  /**
   * Create a new wallet for a user
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object>} Created wallet information
   */
  async createWallet() {
    try {
      // Create a new wallet set
      const walletSetResponse = await this.walletSDK.createWalletSet({
        name: "WalletSet 1",
      });

      const currentNetwork = networkService.getCurrentNetwork();
      const accountType = currentNetwork.name.startsWith("AVAX")
        ? "EOA"
        : "SCA";

      // Create wallet in the wallet set
      const walletData = await this.walletSDK.createWallets({
        idempotencyKey: uuidv4(),
        blockchains: [currentNetwork.name],
        accountType: accountType,
        walletSetId: walletSetResponse.data?.walletSet?.id ?? "",
      });

      const walletId = walletData.data.wallets[0].id;
      return { walletId, walletData };
    } catch (error) {
      console.error("Error creating wallet:", error);
      throw error;
    }
  }

  /**
   * Get the balance of a specific wallet
   * @param {string} walletId - Circle wallet ID
   * @returns {Promise<Object>} Wallet balance information
   */
  async getWalletBalance(walletId) {
    try {
      const network = networkService.getCurrentNetwork();
      const response = await axios.get(
        `https://api.circle.com/v1/w3s/wallets/${walletId}/balances`,
        {
          headers: {
            Authorization: `Bearer ${config.circle.apiKey}`,
          },
        },
      );

      const balances = response.data.data.tokenBalances;
      const networkTokenId = network.usdcTokenId;
      console.log("Checking balance for token ID:", networkTokenId);
      console.log("Available balances:", balances);

      const usdcBalance =
        balances.find((b) => b.token.id === networkTokenId)?.amount || "0";

      return {
        usdc: usdcBalance,
        network: network.name,
      };
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      throw error;
    }
  }

  /**
   * Send a transaction from a wallet
   * @param {string} walletId - Circle wallet ID
   * @param {string} destinationAddress - Destination address
   * @param {string} amount - Amount to send
   * @returns {Promise<Object>} Transaction response
   */
  async sendTransaction(walletId, destinationAddress, amount) {
    try {
      await this.init();
      const network = networkService.getCurrentNetwork();
      const response = await this.walletSDK.createTransaction({
        walletId: walletId,
        tokenId: network.usdcTokenId,
        destinationAddress: destinationAddress,
        amounts: [amount],
        fee: {
          type: "level",
          config: {
            feeLevel: "LOW",
          },
        },
      });
      return response.data;
    } catch (error) {
      console.error("Error sending transaction:", error);
      throw error;
    }
  }

  /**
   * Retrieve Circle wallet ID using wallet address
   * @param {string} address - Wallet address
   * @returns {Promise<string>} Circle wallet ID
   */
  async getWalletId(address) {
    try {
      const response = await axios.get(
        `https://api.circle.com/v1/w3s/wallets?address=${address}`,
        {
          headers: {
            Authorization: `Bearer ${config.circle.apiKey}`,
          },
        },
      );
      return response.data.data.wallets[0]?.id;
    } catch (error) {
      console.error("Error retrieving wallet ID:", error);
      throw error;
    }
  }
}

module.exports = CircleService;
