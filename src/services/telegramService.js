/*================================================
FILE: src/services/telegramService.js
================================================*/

const TelegramBot = require("node-telegram-bot-api");
const config = require("../config/index.js");
const CircleService = require("./circleService");
const supabaseService = require("./supabaseService"); // <-- Replaced storageService
const networkService = require("./networkService");
const { GoogleGenerativeAI } = require('@google/generative-ai');

const geminiApiKey = process.env.GEMINI_API_KEY;

class TelegramService {
  constructor() {
    if (!config?.telegram?.botToken) {
      throw new Error("Telegram bot token is missing");
    }
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });

    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

    this.circleService = new CircleService(this.bot);
    this.initializeCircleSDK().catch((error) => {
      console.error("Failed to initialize Circle SDK:", error);
    });
    this.setupCommands();
  }

  async initializeCircleSDK() {
    try {
      await this.circleService.init();
    } catch (error) {
      console.error("Error initializing Circle SDK:", error);
    }
  }

  setupCommands() {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/createWallet/, this.handleCreateWallet.bind(this));
    this.bot.onText(/\/balance/, this.handleBalance.bind(this));
    this.bot.onText(/\/send (.+)/, this.handleSend.bind(this));
    this.bot.onText(/\/address/, this.handleAddress.bind(this));
    this.bot.onText(/\/walletId/, this.handleWalletId.bind(this));
    this.bot.onText(/\/network (.+)/, this.handleNetwork.bind(this));
    this.bot.onText(/\/networks/, this.handleListNetworks.bind(this));

    this.bot.on('message', async (msg) => {
        // We will enhance this later to prevent it from firing on commands.
        if (msg.text && msg.text.startsWith('/')) {
            return;
        }
      const chatId = msg.chat.id;
      const userText = msg.text;

      try {
        const result = await this.model.generateContent(userText);
        const response = await result.response;
        const text = response.text();

        this.bot.sendMessage(chatId, text);
      } catch (error) {
        console.error("Error interacting with Gemini API:", error);
        this.bot.sendMessage(chatId, "Sorry, I couldn't process your request at the moment.");
      }
    });
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const message = `Welcome to Circle Wallet Bot!\n\nCommands:\n/createWallet - Create a wallet\n/address - Get wallet address\n/walletId - Get wallet ID\n/balance - Check USDC balance\n/send <address> <amount> - Send USDC\n/network <network> - Switch network\n/networks - List available networks`;
    await this.bot.sendMessage(chatId, message);
  }

  async handleNetwork(msg, match) {
    const chatId = msg.chat.id;
    const networkName = match[1].toUpperCase();

    try {
      const network = networkService.setNetwork(networkName);
      await this.bot.sendMessage(
        chatId,
        `Switched to network: ${network.name} ${network.isTestnet ? "(Testnet)" : ""}\nUSDC Address: ${network.usdcAddress}`,
      );
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `Error: Invalid network. Use /networks to see available networks.`,
      );
    }
  }

  async handleListNetworks(msg) {
    const chatId = msg.chat.id;
    const networks = networkService.getAllNetworks();
    const networksMessage = Object.entries(networks)
      .map(
        ([key, network]) =>
          `${network.name} ${network.isTestnet ? "(Testnet)" : ""}`,
      )
      .join("\n");
    await this.bot.sendMessage(
      chatId,
      `Available networks:\n${networksMessage}\n\nUse /network <name> to switch networks`,
    );
  }

  async handleCreateWallet(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const currentNetwork = networkService.getCurrentNetwork();

    try {
      await this.circleService.init();

      const existingWallet = await supabaseService.getWallet(userId, currentNetwork.name);
      if (existingWallet) {
        await this.bot.sendMessage(
          chatId,
          `You already have a wallet on ${currentNetwork.name}!\n` +
          `Your wallet address: ${existingWallet.address}\n\n` +
          `Use /network <network-name> to switch networks if you want to create a wallet on another network.`,
        );
        return;
      }

      const walletResponse = await this.circleService.createWallet();
      if (!walletResponse?.walletData?.data?.wallets?.[0]) {
        throw new Error(
          "Failed to create wallet - invalid response from Circle API",
        );
      }

      const newWallet = walletResponse.walletData.data.wallets[0];
      await supabaseService.saveWallet(
        userId,
        walletResponse.walletid,
        newWallet.address,
        currentNetwork.name
      );

      await this.bot.sendMessage(
        chatId,
        `✅ Wallet created on ${currentNetwork.name}!\nAddress: ${newWallet.address}`,
      );
    } catch (error) {
      console.error("Wallet creation error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Unknown error occurred";
      await this.bot.sendMessage(
        chatId,
        `❌ Error creating wallet: ${errorMessage}\nPlease try again later.`,
      );
    }
  }

  async handleBalance(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const currentNetwork = networkService.getCurrentNetwork().name;

    try {
      const wallet = await supabaseService.getWallet(userId, currentNetwork);
      if (!wallet) {
        await this.bot.sendMessage(
          chatId,
          "Create a wallet first with /createWallet",
        );
        return;
      }

      const balance = await this.circleService.getWalletBalance(wallet.walletid);
      await this.bot.sendMessage(
        chatId,
        `USDC Balance on ${balance.network}: ${balance.usdc} USDC`,
      );
    } catch (error) {
      console.error("Error in handleBalance:", error);
      await this.bot.sendMessage(
        chatId,
        "Error getting balance. Try again later.",
      );
    }
  }

  async handleAddress(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const currentNetwork = networkService.getCurrentNetwork().name;

    const wallet = await supabaseService.getWallet(userId, currentNetwork);
    console.log("teleServ wallet from Supabase wallet:", wallet);
    if (!wallet) {
      await this.bot.sendMessage(
        chatId,
        `No wallet found for ${currentNetwork}. Create one with /createWallet`,
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `Wallet address on ${currentNetwork}: ${wallet.address}`,
    );
  }

  async handleWalletId(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const currentNetwork = networkService.getCurrentNetwork().name;

    const wallet = await supabaseService.getWallet(userId, currentNetwork);
    if (!wallet) {
      await this.bot.sendMessage(
        chatId,
        `No wallet found for ${currentNetwork}. Create one with /createWallet`,
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `Wallet ID on ${currentNetwork}: ${wallet.walletid}`,
    );
  }

  async handleSend(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    try {
      const currentNetwork = networkService.getCurrentNetwork().name;
      const wallet = await supabaseService.getWallet(userId, currentNetwork);

      if (!wallet) {
        throw new Error(
          `No wallet found for ${currentNetwork}. Please create a wallet first using /createWallet`,
        );
      }

      const params = match[1].split(" ");
      if (params.length !== 2) {
        throw new Error("Invalid format. Use: /send <address> <amount>");
      }

      const [destinationAddress, amount] = params;
      await this.bot.sendMessage(
        chatId,
        `Processing transaction on ${currentNetwork}...`,
      );

      const txResponse = await this.circleService.sendTransaction(
        wallet.walletid,
        destinationAddress,
        amount,
      );

      const message =
        `✅ Transaction submitted on ${currentNetwork}!\n\n` +
        `Amount: ${amount} USDC\n` +
        `To: ${destinationAddress}\n` +
        `Transaction ID: ${txResponse.id}`;

      await this.bot.sendMessage(chatId, message);
    } catch (error) {
      console.error("Error sending transaction:", error);
      await this.bot.sendMessage(
        chatId,
        `❌ Error: ${error.message || "Failed to send transaction. Please try again later."}`,
      );
    }
  }
}

module.exports = new TelegramService();