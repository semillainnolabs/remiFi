const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const supabaseService = require("./supabaseService");

// NOTE: This service uses the Circle Business Account API, not the W3S SDK.
const businessApi = axios.create({
  baseURL: "https://api-sandbox.circle.com/v1/businessAccount",
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
    const response = await businessApi.post("/banks/wires", {
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
    const response = await businessApi.post("/wallets/addresses/recipient", {
      idempotencyKey: uuidv4(),
      chain: "ETH", // Per Circle sandbox documentation
      address: userWalletAddress,
      currency: "USD",
      description: `RemiFi user wallet for ${user.tg_username}`,
    });

    const recipientId = response.data.data.id;
    await supabaseService.updateUserCircleIds(user.tg_id, { recipient_address_id: recipientId });
    return recipientId;
  }

  /**
   * Executes the full mock deposit flow.
   * @param {object} user - The user object from Supabase.
   * @param {string} userWalletAddress - The user's RemiFi wallet address.
   * @param {string} amount - The amount to deposit.
   */
  async executeMockDepositFlow(user, userWalletAddress, amount) {
    // Step 1 & 2: Get bank account and wire instructions
    const bankAccountId = await this.findOrCreateBankAccount(user);
    const instructionsResponse = await businessApi.get(`/banks/wires/${bankAccountId}/instructions`);
    const beneficiaryAccountNumber = instructionsResponse.data.data.beneficiaryBank.accountNumber;

    // Step 3 & 4: Execute mock wire transfer and confirm it's processing
    console.log(`Submitting mock wire deposit for ${amount} USD.`);
    await businessApi.post("/mocks/payments/wire", {
      amount: { amount, currency: "USD" },
      beneficiaryBank: { accountNumber: beneficiaryAccountNumber },
    });
    // Note: In a real app, you'd poll the /deposits endpoint. For this flow, we assume it will succeed.

    // Step 5: Add user's wallet as an approved recipient
    const recipientAddressId = await this.findOrCreateRecipientAddress(user, userWalletAddress);

    // Step 6 & 7: Transfer the funds from Circle business balance to the user's wallet
    console.log(`Creating crypto transfer to user's wallet.`);
    const transferResponse = await businessApi.post("/transfers", {
      idempotencyKey: uuidv4(),
      destination: {
        type: "verified_blockchain",
        addressId: recipientAddressId,
      },
      amount: { currency: "USD", amount },
    });

    // In a real app, you'd poll this transfer ID for completion.
    // For now, we return the initiated transfer data.
    return transferResponse.data.data;
  }
}

module.exports = new CircleBusinessService();