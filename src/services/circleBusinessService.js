const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const supabaseService = require("./supabaseService");

// NOTE: This service uses the Circle Business Account API, not the W3S SDK.
const businessApi = axios.create({
  baseURL: "https://api-sandbox.circle.com/v1",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.CIRCLE_SANDBOX_API_KEY}`,
  },
});

class CircleBusinessService {
  /**
   * Creates a mock bank account for the user if they don't have one.
   * @param {object} user - The user object from Supabase.
   * @returns {string} The Circle bank account ID.
   */
  async findOrCreateBankAccount(user) {
    if (user.circle_bank_account_id) {
      console.log("User already has a bank account ID.");
      return user.circle_bank_account_id;
    }

    console.log("Creating a new mock bank account for user:", user.tg_id);
    const response = await businessApi.post("/businessAccount/banks/wires", {
      idempotencyKey: uuidv4(),
      accountNumber: "12340010", // Mock data from Circle docs
      routingNumber: "121000248",
      billingDetails: {
        name: `${user.first_name} ${user.last_name}`,
        city: "Boston",
        country: "US",
        line1: "100 Money Street",
        district: "MA",
        postalCode: "01234",
      },
      bankAddress: {
        country: "US",
        district: "CA",
      },
    });

    const bankAccountId = response.data.data.id;
    await supabaseService.updateUserCircleIds(user.tg_id, { bank_account_id: bankAccountId });
    return bankAccountId;
  }

  /**
   * Adds the user's RemiFi wallet as an approved recipient address.
   * @param {object} user - The user object from Supabase.
   * @param {string} userWalletAddress - The user's RemiFi wallet address.
   * @returns {string} The Circle recipient address ID.
   */
  async findOrCreateRecipientAddress(user, userWalletAddress) {
    if (user.circle_recipient_address_id) {
      console.log("User already has a recipient address ID.");
      return user.circle_recipient_address_id;
    }

    console.log("Creating a new recipient address for user:", user.tg_id);
    // IMPORTANT: The sandbox only supports ETH-SEPOLIA for this API.
    const response = await businessApi.post("/businessAccount/wallets/addresses/recipient", {
      idempotencyKey: uuidv4(),
      chain: "BASE", // The Business API deposits to BASE-SEPOLIA in sandbox
      address: userWalletAddress,
      currency: "USD",
      description: `RemiFi user wallet for ${user.tg_username}`,
    });

    const recipientId = response.data.data.id;
    console.log("Recipient address created id:", recipientId);
    await supabaseService.updateUserCircleIds(user.tg_id, { recipient_address_id: recipientId });
    return recipientId;
  }

  /**
   * Executes the full mock deposit and bridge flow.
   * @param {object} user - The user's Supabase profile.
   * @param {string} amount - The amount to deposit.
   * @param {object} sourceWallet - The user's wallet on BASE-SEPOLIA.
   * @param {object} destinationWallet - The user's wallet on ARC-TESTNET.
   * @param {CircleService} circleService - The instance of CircleService for bridging.
   * @param {TelegramBot} bot - The Telegram bot instance for sending messages.
   * @param {number} chatId - The chat ID to send updates to.
   */
  async executeMockDepositFlow(user, amount, sourceWallet, destinationWallet, circleService, bot, chatId) {
    // Step 1 & 2: Get bank account and wire instructions
    bot.sendMessage(chatId, "Okay, I'm connecting to the bank now... 🏦");
    const bankAccountId = await this.findOrCreateBankAccount(user);
    const instructionsResponse = await businessApi.get(`/businessAccount/banks/wires/${bankAccountId}/instructions`);
    const beneficiaryAccountNumber = instructionsResponse.data.data.beneficiaryBank.accountNumber;

    // Step 3: Transfer instructions for real transfers
    bot.sendMessage(chatId, `For real bank deposits you would need to make a wire transfer with the following details:\n Name: ${instructionsResponse.data.data.beneficiary.name}\nBank: ${instructionsResponse.data.data.beneficiaryBank.name}\nAccount #: ${instructionsResponse.data.data.beneficiaryBank.accountNumber}\nRouting #: ${instructionsResponse.data.data.beneficiaryBank.routingNumber}\n\nBut for testing puroposes we are going to mock the transfer.`);

    // Step 4: Execute mock wire transfer
    bot.sendMessage(chatId, "Submitting your deposit request now!");
    await businessApi.post("/mocks/payments/wire", {
      amount: { amount, currency: "USD" },
      beneficiaryBank: { accountNumber: beneficiaryAccountNumber },
    });

    // Step 5: Add user's Base Sepolia wallet as an approved recipient for the deposit
    const recipientAddressId = await this.findOrCreateRecipientAddress(user, sourceWallet.address);

    // Step 6 & 7: Transfer the funds from Circle business balance to the user's Base Sepolia wallet
    bot.sendMessage(chatId, "Your deposit is being processed by the bank. I'll move the funds to your account as soon as they arrive.");
    const transferResponse = await businessApi.post("/businessAccount/transfers", {
      idempotencyKey: uuidv4(),
      destination: { type: "verified_blockchain", addressId: recipientAddressId },
      amount: { currency: "USD", amount },
    });

    // Simulate waiting for the deposit and transfer to complete
    await new Promise(resolve => setTimeout(resolve, 5000)); // 15-second delay for simulation
    
    await bot.sendMessage(chatId, `Awesome, your $${amount} have arrived!!`);
    await bot.sendMessage(chatId, `Now, I'm moving them to your main RemiFi account on Arc(from Base). This involves some magic called a 'bridge'... 🌉`);

    // FINAL STEP: Bridge the funds from Base Sepolia to Arc Testnet
    const bridgeResult = await circleService.crossChainTransfer(
      sourceWallet.walletid,
      "BASE-SEPOLIA",
      "ARC-TESTNET",
      destinationWallet.address,
      amount,
      chatId,
      destinationWallet.walletid,
    );

    await bot.sendMessage(chatId, `All done! Your $${amount} are now safely in your main account. ✨`);
    
    return bridgeResult;
  }
}

module.exports = CircleBusinessService;