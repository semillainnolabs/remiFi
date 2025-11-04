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

  /**
   * Execute a cross-chain transfer of USDC
   * @param {string} walletId - Source wallet ID
   * @param {string} walletAddress - Source wallet address
   * @param {string} destinationNetwork - Destination network name
   * @param {string} destinationAddress - Destination address
   * @param {string} amount - Amount to transfer
   * @param {string} chatId - Telegram chat ID for updates
   * @param {string} destinationWalletId - Destination wallet ID
   * @returns {Promise<Object>} Transaction IDs for approve, burn, and receive transactions
   */
  async crossChainTransfer(
    walletId,
    destinationNetwork,
    destinationAddress,
    amount,
    chatId,
    destinationWalletId,
  ) {
    try {
      await this.init();
      const currentNetwork = networkService.getCurrentNetwork();

      const usdcAmount = BigInt(amount) * BigInt(10 ** 6);

      const sourceConfig = CCTP.contracts[currentNetwork.name];

      // 1. Approve USDC transfer
      await this.bot.sendMessage(
        chatId,
        "Step 1/4: Approving USDC transfer...",
      );

      const entitySecretCiphertext =
        await this.walletSDK.generateEntitySecretCiphertext();

      const approveTxResponse =
        await this.walletSDK.createContractExecutionTransaction({
          walletId: walletId,
          entitySecretCiphertext: entitySecretCiphertext,
          contractAddress: sourceConfig.usdc,
          abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [sourceConfig.tokenMessenger, usdcAmount.toString()],
          fee: {
            type: "level",
            config: {
              feeLevel: "LOW",
            },
          },
        });

      console.log("Approve transaction response:", approveTxResponse.data);

      // Wait for transaction to be confirmed
      let approveTxStatus;
      do {
        const statusResponse = await this.walletSDK.getTransaction({
          id: approveTxResponse.data.id,
        });
        approveTxStatus = statusResponse.data.transaction.state;
        if (approveTxStatus === "FAILED") {
          throw new Error("Approve transaction failed");
        }
        if (approveTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } while (approveTxStatus !== "CONFIRMED");

      console.log("approve txn", approveTxStatus);

      await this.bot.sendMessage(
        chatId,
        `✅ Approval transaction confirmed: ${approveTxResponse.data.id}`,
      );

      // 2. Create burn transaction
      await this.bot.sendMessage(chatId, "Step 2/4: Initiating USDC burn...");

      const mintRecipientAddressInBytes32 = pad(destinationAddress);

      const maxFee = usdcAmount / BigInt(5000);

      const burnEntitySecretCiphertext =
        await this.walletSDK.generateEntitySecretCiphertext();

      const burnTxResponse =
        await this.walletSDK.createContractExecutionTransaction({
          walletId: walletId,
          entitySecretCiphertext: burnEntitySecretCiphertext,
          contractAddress: sourceConfig.tokenMessenger,
          abiFunctionSignature:
            "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
          abiParameters: [
            usdcAmount.toString(),
            CCTP.domains[destinationNetwork].toString(),
            mintRecipientAddressInBytes32,
            sourceConfig.usdc,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            maxFee.toString(),
            "1000",
          ],
          fee: {
            type: "level",
            config: {
              feeLevel: "MEDIUM",
            },
          },
        });

      console.log("Burn transaction response:", burnTxResponse);

      // Wait for transaction to be confirmed
      let burnTxStatus;
      let statusResponse;
      do {
        statusResponse = await this.walletSDK.getTransaction({
          id: burnTxResponse.data.id,
        });
        burnTxStatus = statusResponse.data.transaction.state;
        if (burnTxStatus === "FAILED") {
          throw new Error("Burn transaction failed");
        }
        if (burnTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } while (burnTxStatus !== "CONFIRMED");

      await this.bot.sendMessage(
        chatId,
        `✅ Burn transaction confirmed: ${burnTxResponse.data.id}`,
      );

      // 3. Get attestation
      await this.bot.sendMessage(
        chatId,
        "Step 3/4: Waiting for attestation...",
      );

      // Get transaction hash from status response
      const txHash = statusResponse.data.transaction.txHash;
      const srcDomainId = CCTP.domains[currentNetwork.name];

      // Wait 30 seconds before starting to poll for attestation
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Starting attestation polling...");

      const attestation = await this.waitForAttestation(
        srcDomainId.toString(),
        txHash,
      );
      await this.bot.sendMessage(chatId, "✅ Attestation received!");

      // 4. Receive on destination chain
      await this.bot.sendMessage(
        chatId,
        "Step 4/4: Finalizing transfer on destination chain...",
      );
      const destinationConfig = CCTP.contracts[destinationNetwork];

      // Generate new ciphertext for receive transaction
      const receiveEntitySecretCiphertext =
        await this.walletSDK.generateEntitySecretCiphertext();

      const receiveTxResponse =
        await this.walletSDK.createContractExecutionTransaction({
          walletId: destinationWalletId,
          entitySecretCiphertext: receiveEntitySecretCiphertext,
          contractAddress: destinationConfig.messageTransmitter,
          abiFunctionSignature: "receiveMessage(bytes,bytes)",
          abiParameters: [attestation.message, attestation.attestation],
          fee: {
            type: "level",
            config: {
              feeLevel: "MEDIUM",
            },
          },
        });

      console.log("Receive transaction response:", receiveTxResponse.data);

      // Wait for transaction to be confirmed
      let receiveTxStatus;
      do {
        const statusResponse = await this.walletSDK.getTransaction({
          id: receiveTxResponse.data.id,
        });
        receiveTxStatus = statusResponse.data.transaction.state;
        console.log("Receive transaction status:", receiveTxStatus);
        if (receiveTxStatus === "FAILED") {
          throw new Error("Receive transaction failed");
        }
        if (receiveTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } while (receiveTxStatus !== "CONFIRMED");

      await this.bot.sendMessage(
        chatId,
        `✅ Receive transaction confirmed: ${receiveTxResponse.data.id}`,
      );

      return {
        approveTx: approveTxResponse.data.id,
        burnTx: burnTxResponse.data.id,
        receiveTx: receiveTxResponse.data.id,
      };
    } catch (error) {
      console.error("Error in cross-chain transfer:", error);
      throw error;
    }
  }

  /**
   * Polls for attestation until it's complete or timeout is reached
   * @param {string} srcDomainId - Source domain ID
   * @param {string} transactionHash - Transaction hash
   * @returns {Promise<Object>} Attestation message and attestation data
   */
  async waitForAttestation(srcDomainId, transactionHash) {
    const maxAttempts = 30; // 5 minutes total with 10-second intervals
    let attempts = 0;

    try {
      while (attempts < maxAttempts) {
        attempts++;
        const url = `https://iris-api-sandbox.circle.com/v2/messages/${srcDomainId}?transactionHash=${transactionHash}`;

        try {
          const response = await axios.get(url, {
            headers: {
              Authorization: `Bearer ${config.circle.apiKey}`,
              "Content-Type": "application/json",
            },
          });

          console.log("Attestation response:", response.data);
          console.log("attestation response without", response);

          if (response.data?.messages?.[0]?.status === "complete") {
            const { message, attestation } = response.data?.messages[0];
            return { message, attestation };
          }
        } catch (error) {
          if (error.response?.status === 404) {
            console.log(
              `Attempt ${attempts}/${maxAttempts}: Attestation not ready yet`,
            );
          } else {
            throw error;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
      throw new Error("Timeout waiting for attestation");
    } catch (error) {
      console.error(`Failed to get attestation: ${error}`);
      throw error;
    }
  }
}

module.exports = CircleService;
