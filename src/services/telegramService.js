/*================================================
FILE: src/services/telegramService.js
================================================*/

const TelegramBot = require("node-telegram-bot-api");
const config = require("../config/index.js");
const CircleService = require("./circleService");
const supabaseService = require("./supabaseService");
const networkService = require("./networkService");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const CircleBusinessService = require("./circleBusinessService");

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL;

const tools = [
  {
    "functionDeclarations": [
      {
        "name": "get_balance",
        "description": "Get the user's balance of digital dollars.",
        "parameters": { "type": "OBJECT", "properties": {} }
      },
      {
        "name": "send_money",
        "description": "Send a specified amount of digital dollars to a recipient. The recipient can be identified by a saved contact nickname OR a direct wallet address.",
        "parameters": {
          "type": "OBJECT",
          "properties": {
            "recipient": { "type": "STRING", "description": "The recipient's saved contact nickname (e.g., 'Mom') or their full wallet address (e.g., '0x...')." },
            "amount": { "type": "STRING", "description": "The amount of digital dollars to send (e.g., '10.50')." }
          },
          "required": ["recipient", "amount"]
        }
      },
      {
        "name": "add_contact",
        "description": "Saves a new person to the user's contact list. The user must provide a nickname and the person's Telegram username.",
        "parameters": {
          "type": "OBJECT",
          "properties": {
            "nickname": { "type": "STRING", "description": "The name to save for the contact (e.g., 'Mom', 'Juan')." },
            "telegram_username": { "type": "STRING", "description": "The contact's Telegram username, which must start with '@'." }
          },
          "required": ["nickname", "telegram_username"]
        }
      },
      {
        "name": "deposit_money",
        "description": "Initiates a deposit of USD into the user's account, which will be converted to digital dollars.",
        "parameters": {
          "type": "OBJECT",
          "properties": {
            "amount": { "type": "STRING", "description": "The amount of USD to deposit (e.g., '50.00')." }
          },
          "required": ["amount"]
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

    //Tweaked system prompt to encourage tool use
    const systemInstruction = `You are RemiFi, a friendly and helpful AI assistant. Your goal is to help users manage their money with ease. When you talk about the currency, always call it 'digital dollars' or use the '$' symbol; never say 'USDC'. Your tone should be conversational and reassuring, like talking to a friend.

When a user asks you to perform an action, your first priority is to use the available tools. Here are some examples:

User query: "send $25 to my mom"
Your action: call 'send_money' tool with arguments {"recipient": "mom", "amount": "25"}

User query: "can you send 1.50 to my sister please"
Your action: call 'send_money' tool with arguments {"recipient": "sister", "amount": "1.50"}

User query: "add @coolfriend as my bestie"
Your action: call 'add_contact' tool with arguments {"nickname": "bestie", "telegram_username": "@coolfriend"}

User query: "I want to deposit $50"
Your action: call 'deposit_money' tool with arguments {"amount": "50"}

Always respond in plain text, without markdown, and avoid blockchain words. Feel free to use emojis. 👍`;

    const generationConfig = { temperature: 0.3 };

    this.model = this.genAI.getGenerativeModel({ model: geminiModel, tools, generationConfig, systemInstruction });
    //this.textModel = this.genAI.getGenerativeModel({ model: geminiModel, generationConfig, systemInstruction });

    this.circleService = new CircleService(this.bot);
    this.initializeCircleSDK().catch((error) => {
      console.error("Failed to initialize Circle SDK:", error);
    });

    this.circleBusinessService = new CircleBusinessService();

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
    this.bot.onText(/\/cctp (.+)/, this.handleCCTP.bind(this));
    this.bot.on('message', this.handleNaturalLanguage.bind(this));
  }

  async sendFriendlyResponse(chatId, action, data, userText) {
    let prompt;
    switch (action) {
      case 'balance_check_success':
        prompt = `The user asked: "${userText}". I checked and their balance is ${data.balance} digital dollars. Tell them their balance in a friendly, reassuring way.`;
        break;
      case 'send_success':
        prompt = `The user asked: "${userText}". I successfully sent ${data.amount} digital dollars to ${data.recipient}. Tell them the transaction was successful and the money is on the way.`;
        break;
      case 'add_contact_success':
        prompt = `The user asked to add a contact. I successfully added ${data.nickname} to their contacts list. Congratulate them and let them know they can now send money to this person by name.`;
        break;
      case 'deposit_money':
        break;
      default:
        await this.bot.sendMessage(chatId, "All done! 👍");
        return;
    }
    try {
      const result = await this.model.generateContent(prompt);
      await this.bot.sendMessage(chatId, result.response.text());
    } catch (error) {
      console.error("Error generating friendly response:", error);
      await this.bot.sendMessage(chatId, `Action completed successfully!`);
    }
  }

  async handleNaturalLanguage(msg) {
    if (msg.text && msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userText = msg.text;

    try {
      const chat = this.model.startChat();
      const result = await chat.sendMessage(userText);
      const call = result.response.functionCalls()?.[0];

      //console.log("telServ handleNat result.response.text():", result.response.text(), " call:", call);

      if (call) {
        const { name, args } = call;
        switch (name) {
          case 'get_balance':
            await this._executeBalanceCheck(chatId, userId, userText);
            break;
          case 'send_money':
            if (args.recipient && args.amount) {
              await this._executeSend(chatId, userId, args.recipient, args.amount, userText);
            } else {
              await this.bot.sendMessage(chatId, "I can help with that! Just need to know who to send to and the amount.");
            }
            break;
          case 'add_contact':
            if (args.nickname && args.telegram_username) {
              await this._executeAddContact(chatId, userId, args.nickname, args.telegram_username, userText);
            } else {
              await this.bot.sendMessage(chatId, "To add a contact, I need a nickname and their Telegram username (like @username).");
            }
            break;
          case 'deposit_money':
            if (args.amount) {
              await this._executeDeposit(chatId, userId, args.amount, userText);
            } else {
              await this.bot.sendMessage(chatId, "I can help with that! How much would you like to deposit?");
            }
            break;
          default:
            await this.bot.sendMessage(chatId, "Sorry, I'm not sure how to handle that request. 🤔");
        }
      } else {
        const text = result.response.text();
        this.bot.sendMessage(chatId, text);
      }
    } catch (error) {
      console.error("Error in AI message handler:", error);
      this.bot.sendMessage(chatId, "Oh no, something went wrong on my end. Could you please try rephrasing your request?");
    }
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const { id: tgId, username, first_name, last_name } = msg.from;

    try {
      //const userId = process.env.TG_ID_RECIPIENT;
      const userId = tgId;
      await this.bot.sendMessage(chatId, `Hey ${first_name}, welcome to RemiFi! 💸 Let me get things set up for you...`);
      await supabaseService.findOrCreateUser(userId, username, first_name, last_name);
      //await supabaseService.findOrCreateUser(userId, "maryperez21", "Maria", "Perez");

      const currentNetwork = networkService.getCurrentNetwork();
      const existingWallet = await supabaseService.getWallet(userId, currentNetwork.name);

      if (existingWallet) {
        await this.bot.sendMessage(chatId, `Looks like you're all set! Your digital dollar account is active. You can start by asking me things like:\n\n"check my balance", for getting your balance in digital dollars.\n\n"add @username as Mom", for adding a recipient using their Telegram's username.\n\n"send $10 to my Mom", to send money to one of the recipients you added previously if you have enough balance.\n\n"deposit $15", if you need to deposit digital dollars in your account from your bank (with a wire transfer).`);
      } else {
        await this.bot.sendMessage(chatId, `I'm creating your secure digital dollar account now. This will just take a moment... 🛠️`);

        const walletResponse = await this.circleService.createWallet();
        if (!walletResponse?.walletData?.data?.wallets?.[0]) {
          throw new Error("I couldn't get a valid response from Circle to create the wallet.");
        }
        const newWallet = walletResponse.walletData.data.wallets[0];
        await supabaseService.saveWallet(userId, walletResponse.walletid, newWallet.address, currentNetwork.name);

        await this.bot.sendMessage(chatId, `✅ All done! Your account is ready.\n\nYou can now add contacts and send money just by using their Telegram username. Try asking me: "add @username as Mom" 👍`);
      }
    } catch (error) {
      console.error("Error during handleStart onboarding:", error);
      await this.bot.sendMessage(chatId, `❌ Whoops, I ran into a little trouble setting things up. ${error.message}`);
    }
  }

  async _executeAddContact(chatId, userId, nickname, username, userText = null) {
    try {
      const contactUser = await supabaseService.findUserByUsername(username);
      if (!contactUser) {
        throw new Error(`I couldn't find anyone with the username ${username}. Please make sure they have started a conversation with me first!`);
      }

      await supabaseService.saveContact(userId, nickname.toLowerCase(), contactUser.tg_id);

      if (userText) {
        await this.sendFriendlyResponse(chatId, 'add_contact_success', { nickname }, userText);
      } else {
        await this.bot.sendMessage(chatId, `Success! I've added ${nickname} (${username}) to your contacts. 👍`);
      }
    } catch (error) {
      console.error("Error adding contact:", error);
      await this.bot.sendMessage(chatId, `❌ Oh no, I couldn't add that contact. ${error.message}`);
    }
  }

  async _executeSend(chatId, userId, recipient, amount, userText = null) {
    try {
      const currentNetwork = networkService.getCurrentNetwork().name;
      const senderWallet = await supabaseService.getWallet(userId, currentNetwork);
      if (!senderWallet) throw new Error(`You need a wallet to send money. Use /createWallet to get started!`);

      let destinationAddress;
      if (recipient.startsWith('0x') && recipient.length === 42) {
        destinationAddress = recipient;
      } else {
        const contactWallet = await supabaseService.getContactWallet(userId, recipient.toLowerCase(), currentNetwork);
        if (!contactWallet) {
          throw new Error(`I couldn't find a contact named '${recipient}'. Please check the name or add them as a contact first saying somethin like 'add @neat${recipient}25 as my ${recipient}'`);
        }
        destinationAddress = contactWallet.address;
      }

      console.log("telServ exSend recipient:", recipient, " destinationAddress:", destinationAddress);

      await this.bot.sendMessage(chatId, `Got it. Sending $${amount} to ${recipient}... 💸`);
      const txResponse = await this.circleService.sendTransaction(senderWallet.walletid, destinationAddress, amount);

      if (userText) {
        await this.sendFriendlyResponse(chatId, 'send_success', { amount, recipient }, userText);
      } else {
        const message = `✅ All set!\n\n` +
          `I've sent $${amount} to ${recipient}.\n` +
          `Transaction ID: ${txResponse.id}`;
        await this.bot.sendMessage(chatId, message);
      }
    } catch (error) {
      console.error("Error sending transaction:", error);
      await this.bot.sendMessage(chatId, `❌ Oh no, something went wrong. ${error.message}`);
    }
  }

  async _executeBalanceCheck(chatId, userId, userText = null) {
    try {
      const currentNetwork = networkService.getCurrentNetwork().name;
      const wallet = await supabaseService.getWallet(userId, currentNetwork);
      if (!wallet) {
        await this.bot.sendMessage(chatId, "Looks like you don't have a wallet yet. Just say /start to get set up! 🚀");
        return;
      }
      const balance = await this.circleService.getWalletBalance(wallet.walletid);
      if (userText) {
        await this.sendFriendlyResponse(chatId, 'balance_check_success', { balance: balance.usdc, network: balance.network }, userText);
      } else {
        await this.bot.sendMessage(chatId, `Your balance is: $${balance.usdc}`);
      }
    } catch (error) {
      console.error("Error in _executeBalanceCheck:", error);
      await this.bot.sendMessage(chatId, "Hmm, I couldn't get your balance right now. Please try again in a bit.");
    }
  }

  /**
   * Orchestrates the entire user deposit and bridge flow.
   */
  async _executeDeposit(chatId, userId, amount, userText = null) {
    try {
      await this.bot.sendMessage(chatId, `Got it! I'll start the process to deposit $${amount} into your account. This involves a few steps, so I'll keep you updated. 👍`);

      // 1. Get user data from Supabase
      const user = await supabaseService.findUserByTgId(userId);
      if (!user) throw new Error("I couldn't find your user profile.");

      // 2. Get the final destination wallet on Arc Testnet
      const destinationWallet = await supabaseService.getWallet(userId, "ARC-TESTNET");
      if (!destinationWallet) {
        throw new Error("I couldn't find your main account wallet. Please try running /start again to make sure everything is set up correctly.");
      }
      
      // 3. Get (or create) the temporary source wallet on Base Sepolia for the deposit
      let sourceWallet = await supabaseService.getWallet(userId, "BASE-SEPOLIA");
      if (!sourceWallet) {
        await this.bot.sendMessage(chatId, "Looks like we need a temporary spot to receive your deposit before moving it. Setting that up for you now...");
        const walletResponse = await this.circleService.createWallet("BASE-SEPOLIA");
        const newWallet = walletResponse.walletData.data.wallets[0];
        await supabaseService.saveWallet(userId, walletResponse.walletid, newWallet.address, "BASE-SEPOLIA");
        sourceWallet = { walletid: walletResponse.walletid, address: newWallet.address };
        await this.bot.sendMessage(chatId, "Okay, the temporary spot is ready!");
      }

      // 4. Execute the new, enhanced flow in the business service
      const finalResult = await this.circleBusinessService.executeMockDepositFlow(
        user,
        amount,
        sourceWallet,
        destinationWallet,
        this.circleService, // Pass the circleService instance for bridging
        this.bot,
        chatId
      );

      // 5. Send a final friendly confirmation
      const successPrompt = `The user asked to deposit money. I have just completed the entire mock deposit and bridge process for $${amount}. The funds are now in their main account. Please craft a final, super friendly and reassuring message confirming that everything is complete and the money is in their account and ready to use.`;
      const result = await this.model.generateContent(successPrompt);
      await this.bot.sendMessage(chatId, result.response.text());

    } catch (error) {
      console.error("Error executing deposit flow:", error);
      const errorMessage = error.response?.data?.message || error.message;
      await this.bot.sendMessage(chatId, `❌ Oh no, something went wrong during the deposit. Here's the issue: ${errorMessage}`);
    }
  }

  // Kept for legacy/testing, but onboarding is handled by /start
  async handleCreateWallet(msg) {
    await this.bot.sendMessage(msg.chat.id, "Your wallet is now created automatically when you start a chat with me! Just use the /start command if you haven't already. 😊");
  }

  async handleAddress(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const currentNetwork = networkService.getCurrentNetwork().name;
    const wallet = await supabaseService.getWallet(userId, currentNetwork);
    if (!wallet) {
      await this.bot.sendMessage(chatId, `No wallet found for ${currentNetwork}. Say /start to create one.`);
      return;
    }
    await this.bot.sendMessage(chatId, `Your wallet address on ${currentNetwork} is: ${wallet.address}`);
  }

  async handleCCTP(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    try {
      /*const wallet = storageService.getWallet(userId);
      if (!wallet) {
        await this.bot.sendMessage(
          chatId,
          "Create a wallet first with /createWallet",
        );
        return;
      }*/

      const currentNetwork = networkService.getCurrentNetwork().name;
      const wallet = await supabaseService.getWallet(userId, currentNetwork);
      if (!wallet) {
        await this.bot.sendMessage(chatId, `No wallet found for ${currentNetwork}. Say /start to create one.`);
        return;
      }

      const params = match[1].split(" ");
      if (params.length !== 3) {
        await this.bot.sendMessage(
          chatId,
          "Invalid format. Use: /cctp <destination-network> <address> <amount>",
        );
        return;
      }

      const [destinationNetwork, destinationAddress, amount] = params;
      await this.bot.sendMessage(chatId, "Initiating cross-chain transfer...");
      const userWallet = wallet;//wallet[currentNetwork.name];
      if (!userWallet) {
        await this.bot.sendMessage(
          chatId,
          `No wallet found for ${currentNetwork}. Create one first with /createWallet`,
        );
        return;
      }

      // ARC and BASE have the same wallet address 
      /*const destinationWallet = wallet;//wallet[destinationNetwork.toUpperCase()];
      if (!destinationWallet) {
        await this.bot.sendMessage(
          chatId,
          `No wallet found for ${destinationNetwork}. Create one first with /createWallet`,
        );
        return;
      }*/
      const destinationWallet = await supabaseService.getWallet(userId, destinationNetwork.toUpperCase());
      if (destinationWallet) {
        await this.bot.sendMessage(chatId, `Wallet on destination network found!`);
      } else {
        await this.bot.sendMessage(chatId, `I'm creating your secure digital dollar account now at ${destinationNetwork}. This will just take a moment... 🛠️`);

        const walletResponse = await this.circleService.createWallet(destinationNetwork.toUpperCase());
        if (!walletResponse?.walletData?.data?.wallets?.[0]) {
          throw new Error("I couldn't get a valid response from Circle to create the wallet.");
        }
        const newWallet = walletResponse.walletData.data.wallets[0];
        await supabaseService.saveWallet(userId, walletResponse.walletId, newWallet.address, destinationNetwork.toUpperCase());

        destinationWallet.walletid = walletResponse.walletid;
        destinationWallet.address = walletResponse.newWallet.address;

        await this.bot.sendMessage(chatId, `✅ Wallet created for destination network with id:${walletResponse.walletid}`);
      }

      const result = await this.circleService.crossChainTransfer(
        userWallet.walletid,
        "ARC-TESTNET",
        destinationNetwork.toUpperCase(),
        destinationWallet.address,
        amount,
        chatId,
        destinationWallet.walletid,
      );

      const message =
        `✅ Cross-chain transfer initiated!\n\n` +
        `From: ${currentNetwork.name}\n` +
        `To: ${destinationNetwork}\n` +
        `Amount: ${amount} USDC\n` +
        `Recipient: ${destinationAddress}\n\n` +
        `Transactions:\n` +
        `Approve: ${result.approveTx}\n` +
        `Burn: ${result.burnTx}\n` +
        `Receive: ${result.receiveTx}`;

      await this.bot.sendMessage(chatId, message);
    } catch (error) {
      console.error("Error in CCTP transfer:", error);
      await this.bot.sendMessage(
        chatId,
        `❌ Error: ${error.message || "Failed to execute cross-chain transfer"}`,
      );
    }
  }
}

module.exports = new TelegramService();