/*================================================
FILE: src/services/telegramService.js
================================================*/

const TelegramBot = require("node-telegram-bot-api");
const config = require("../config/index.js");
const CircleService = require("./circleService");
const supabaseService = require("./supabaseService");
const networkService = require("./networkService");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL;

// Define the functions our AI agent can call
const tools = [
  {
    "functionDeclarations": [
      {
        "name": "get_balance",
        "description": "Get the USDC balance for the user's wallet on the current active network.",
        "parameters": { "type": "OBJECT", "properties": {} } // No parameters needed
      },
      {
        "name": "send_usdc",
        "description": "Send a specified amount of USDC to a destination address.",
        "parameters": {
          "type": "OBJECT",
          "properties": {
            "destinationAddress": {
              "type": "STRING",
              "description": "The recipient's wallet address (e.g., '0x123...')"
            },
            "amount": {
              "type": "STRING",
              "description": "The amount of USDC to send (e.g., '10.50')"
            }
          },
          "required": ["destinationAddress", "amount"]
        }
      }
    ]
  }
];

class TelegramService {
  constructor() {
    if (!config?.telegram?.botToken) {
      throw new Error("Telegram bot token is missing");
    }
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });

    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    // Defining the persona for our AI models
    const systemInstruction = {
        role: "model",
        parts: [{ text: "You are RemiFi, a friendly and helpful AI assistant. Your goal is to help users manage their money with ease. When you talk about the currency, always call it 'digital dollars' or use the '$' symbol; never say 'USDC'. Your tone should be conversational and reassuring, like talking to a friend. Always respond in plain text, without any markdown formatting and avoiding blockchain words or concepts. The user is a web2 user so responses should be similar to what they get interacting with their traditional fintech apps. Feel free to use emojis to make the conversation feel natural and lighthearted. 👍" }]
    };

    const generationConfig = {
        temperature: 0.3, // Slightly higher temp for more natural text
    };
    // Model for function calling
    this.toolModel = this.genAI.getGenerativeModel({ model: geminiModel, tools, generationConfig,systemInstruction: systemInstruction.parts[0].text });
    // Model for generating friendly text responses
    this.textModel = this.genAI.getGenerativeModel({ model: geminiModel, tools, generationConfig,systemInstruction: systemInstruction.parts[0].text });



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
    // Commands call the execution methods without a userText, resulting in a standard response
    this.bot.onText(/\/balance/, (msg) => this._executeBalanceCheck(msg.chat.id, msg.from.id));
    this.bot.onText(/\/send (.+)/, (msg, match) => {
        const params = match[1].split(" ");
        if (params.length !== 2) {
            this.bot.sendMessage(msg.chat.id, "Invalid format. Use: /send <address> <amount>");
            return;
        }
        const [destinationAddress, amount] = params;
        this._executeSend(msg.chat.id, msg.from.id, destinationAddress, amount);
    });
    this.bot.onText(/\/address/, this.handleAddress.bind(this));
    this.bot.onText(/\/walletId/, this.handleWalletId.bind(this));
    this.bot.onText(/\/network (.+)/, this.handleNetwork.bind(this));
    this.bot.onText(/\/networks/, this.handleListNetworks.bind(this));

    // Main message handler for AI processing
    this.bot.on('message', this.handleNaturalLanguage.bind(this));
  }

  // NEW: Helper to generate friendly responses using Gemini
  async sendFriendlyResponse(chatId, action, data, userText) {
    let prompt = `You are RemiFi, a friendly AI assistant helping users manage their digital dollars. A user just performed an action. Your task is to craft a natural, reassuring, and clear response.`;

    switch (action) {
        case 'balance_check_success':
            prompt += `\nThe user asked: "${userText}".\nThe action was a successful balance check. Their balance is ${data.balance} digital dollars on the ${data.network} network. Inform them of their balance in a friendly way.`;
            break;
        case 'send_success':
            prompt += `\nThe user asked: "${userText}".\nThe action was a successful transaction. They sent ${data.amount} digital dollars to ${data.destinationAddress}. Tell them the transaction was successful and is being processed. Reassure them that the money is on the way.`;
            break;
        default:
            // Fallback for unknown actions
            await this.bot.sendMessage(chatId, "Action completed successfully!");
            return;
    }
    
    try {
        const result = await this.textModel.generateContent(prompt);
        const text = result.response.text();
        await this.bot.sendMessage(chatId, text);
    } catch (error) {
        console.error("Error generating friendly response:", error);
        // Fallback to a simple message if Gemini fails
        if (action === 'balance_check_success') {
            await this.bot.sendMessage(chatId, `Your balance on ${data.network} is: ${data.balance} USDC`);
        } else if (action === 'send_success') {
            await this.bot.sendMessage(chatId, `✅ Success! Your transaction of ${data.amount} to ${data.destinationAddress} has been submitted.`);
        }
    }
  }

  async handleNaturalLanguage(msg) {
    if (msg.text && msg.text.startsWith('/')) {
        return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userText = msg.text;

    try {
      const chat = this.toolModel.startChat();
      const result = await chat.sendMessage(userText);
      const call = result.response.functionCalls()?.[0];

      if (call) {
        const { name, args } = call;
        switch (name) {
          case 'get_balance':
            // Pass the user's text for context
            await this._executeBalanceCheck(chatId, userId, userText);
            break;
          case 'send_usdc':
            if (args.destinationAddress && args.amount) {
              // Pass the user's text for context
              await this._executeSend(chatId, userId, args.destinationAddress, args.amount, userText);
            } else {
              await this.bot.sendMessage(chatId, "I can help with that! Just need to know the destination address and the amount you want to send.");
            }
            break;
          default:
            await this.bot.sendMessage(chatId, "Sorry, I'm not sure how to handle that request. 🤔");
        }
      } else {
        const response = result.response;
        const text = response.text();
        this.bot.sendMessage(chatId, text);
      }
    } catch (error) {
      console.error("Error in AI message handler:", error);
      this.bot.sendMessage(chatId, "Oh no, something went wrong on my end. Could you please try rephrasing your request?");
    }
  }


  // --- Action Execution Methods (Updated) ---

  // userText is optional. If provided, a friendly response will be generated.
  async _executeBalanceCheck(chatId, userId, userText = null) {
    try {
      const currentNetwork = networkService.getCurrentNetwork().name;
      const wallet = await supabaseService.getWallet(userId, currentNetwork);
      if (!wallet) {
        await this.bot.sendMessage(chatId, "Looks like you don't have a wallet yet. Let's create one for you with /createWallet! 🚀");
        return;
      }
      const balance = await this.circleService.getWalletBalance(wallet.walletid);

      if (userText) {
          // AI-triggered action: Generate a friendly response
          await this.sendFriendlyResponse(chatId, 'balance_check_success', { balance: balance.usdc, network: balance.network }, userText);
      } else {
          // Command-triggered action: Send a standard response
          await this.bot.sendMessage(chatId, `Your balance is: $${balance.usdc}`);
      }
    } catch (error) {
      console.error("Error in _executeBalanceCheck:", error);
      await this.bot.sendMessage(chatId, "Hmm, I couldn't get your balance right now. Please try again in a bit.");
    }
  }

  // userText is optional. If provided, a friendly response will be generated.
  async _executeSend(chatId, userId, destinationAddress, amount, userText = null) {
    try {
      const currentNetwork = networkService.getCurrentNetwork().name;
      const wallet = await supabaseService.getWallet(userId, currentNetwork);

      if (!wallet) {
        throw new Error(`You need a wallet to send money. Use /createWallet to get started!`);
      }

      await this.bot.sendMessage(chatId, `Got it. Sending $${amount} now... 💸`);

      const txResponse = await this.circleService.sendTransaction(
        wallet.walletid,
        destinationAddress,
        amount,
      );

      if (userText) {
          // AI-triggered action: Generate a friendly response
          await this.sendFriendlyResponse(chatId, 'send_success', { amount, destinationAddress }, userText);
      } else {
          // Command-triggered action: Send a standard response
          const message = `✅ Success! Your transaction has been submitted.\n\n` +
                          `Amount: ${amount} USDC\n` +
                          `To: ${destinationAddress}\n` +
                          `Transaction ID: ${txResponse.id}`;
          await this.bot.sendMessage(chatId, message);
      }
    } catch (error) {
      console.error("Error sending transaction:", error);
      await this.bot.sendMessage(chatId, `❌ Oh no, something went wrong. ${error.message || "The transaction failed."}`);
    }
  }

  // --- Other Command Handlers (Unchanged) ---
  
  async handleStart(msg) {
    const chatId = msg.chat.id;
    //console.log("telServ msg:",msg);
    //console.log("telServ msg.chat:",msg.chat);
    const message = `Hey there! I'm RemiFi, your friendly helper for sending and managing digital dollars. 💸\n\nYou can chat with me normally, like "check my balance" or "send $5 to 0x...".\n\nOr use these commands:\n/createWallet\n/address\n/balance\n/send <address> <amount>`;
    await this.bot.sendMessage(chatId, message);
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
          `You're all set! You already have a wallet on ${currentNetwork.name}.\n\nYour address is: ${existingWallet.address}`
        );
        return;
      }

      await this.bot.sendMessage(chatId, `Awesome! Creating your secure wallet on ${currentNetwork.name} now, give me just a sec... 🛠️`);

      const walletResponse = await this.circleService.createWallet();
      if (!walletResponse?.walletData?.data?.wallets?.[0]) {
        throw new Error("I couldn't get a valid response from Circle to create the wallet. So sorry!");
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
        `✅ Done! Your new wallet is ready on ${currentNetwork.name}!\n\nYour address is: ${newWallet.address}`
      );
    } catch (error) {
      console.error("Wallet creation error:", error);
      const errorMessage = error.response?.data?.message || error.message || "Unknown error";
      await this.bot.sendMessage(chatId, `❌ Whoops, I ran into an error trying to create your wallet: ${errorMessage}`);
    }
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

  async handleAddress(msg) {
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
      `Your wallet address on ${currentNetwork}: ${wallet.address}`,
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
      `Your wallet ID on ${currentNetwork}: ${wallet.walletid}`,
    );
  }
}

module.exports = new TelegramService();