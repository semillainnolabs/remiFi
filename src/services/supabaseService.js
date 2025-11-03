const { createClient } = require("@supabase/supabase-js");
const config = require("../config/index.js");
const networkService = require("./networkService.js");

class SupabaseService {
  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error("Supabase URL or Key is missing from environment variables.");
    }
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  /**
   * Creates a user profile if they don't exist, or updates their info if they do.
   * @param {number} tg_id - The user's Telegram ID.
   * @param {string} tg_username - The user's Telegram @username.
   * @param {string} first_name - The user's first name.
   * @param {string} last_name - The user's last name.
   * @returns {Promise<Object>} The user's profile data.
   */
  async findOrCreateUser(tg_id, tg_username, first_name, last_name) {
    const { data, error } = await this.supabase
      .from('users')
      .upsert({
        tg_id,
        tg_username,
        first_name,
        last_name
      }, { onConflict: 'tg_id' }) // Use tg_id to resolve conflicts
      .select();

    if (error) {
      console.error("Error in findOrCreateUser:", error);
      throw new Error(error.message);
    }
    return data[0];
  }

  /**
   * Finds a user by their Telegram @username.
   * @param {string} username - The Telegram username to search for.
   * @returns {Promise<Object|null>} The user's data or null if not found.
   */
  async findUserByUsername(username) {
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    const { data, error } = await this.supabase
      .from('users')
      .select('tg_id')
      .eq('tg_username', cleanUsername)
      .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // 'PGRST116' means no rows found, which is expected.
        console.error("Error finding user by username:", error);
        throw new Error(error.message);
    }
    return data;
  }

  /**
   * Saves a new wallet to the Supabase database.
   * @param {number} tg_id - The user's Telegram ID.
   * @param {string} walletId - The Circle Wallet ID.
   * @param {string} address - The wallet's blockchain address.
   * @param {string} network - The network name (e.g., 'ARC-TESTNET').
   * @returns {Promise<Object>} The saved wallet data.
   */
  async saveWallet(tg_id, walletId, address, network) {
    const { data, error } = await this.supabase
      .from('wallets')
      .insert([
        {
          tg_id: tg_id,
          walletid: walletId,
          walletaddress: address,
          network: network,
        },
      ])
      .select();

    if (error) {
      console.error("Error saving wallet to Supabase:", error);
      throw new Error(error.message);
    }

    return data[0];
  }

  /**
   * Retrieves a wallet from Supabase for a given user and network.
   * @param {number} tg_id - The user's Telegram ID.
   * @param {string} network - The network name.
   * @returns {Promise<Object|null>} The wallet data or null if not found.
   */
  async getWallet(tg_id, network) {
    const { data, error } = await this.supabase
      .from('wallets')
      .select('walletid, walletaddress')
      .eq('tg_id', tg_id)
      .eq('network', network)
      .single(); 

    if (error && error.code !== 'PGRST116') {
      console.error("Error getting wallet from Supabase:", error);
      throw new Error(error.message);
    }

    if (data) {
        return {
            walletid: data.walletid,
            address: data.walletaddress
        };
    }
    return null;
  }
  
  /**
   * Saves a contact relationship to the database.
   * @param {number} user_tg_id - Telegram ID of the user saving the contact.
   * @param {string} nickname - The nickname for the contact.
   * @param {number} contact_tg_id - Telegram ID of the contact being saved.
   * @returns {Promise<Object>} The saved contact data.
   */
  async saveContact(user_tg_id, nickname, contact_tg_id) {
    // Check if the contact has a wallet, which implies they are a user.
    const contactWallet = await this.getWallet(contact_tg_id, networkService.getCurrentNetwork().name);
    if (!contactWallet) {
        throw new Error("The person you're trying to add doesn't have a RemiFi account yet. Please ask them to start a chat with the bot to get set up! 🚀");
    }

    const { data, error } = await this.supabase
      .from('contacts')
      .insert([{ user_tg_id, nickname, contact_tg_id }])
      .select();
      
    if (error) {
        if (error.code === '23505') { // Unique constraint violation
            throw new Error(`You already have a contact named '${nickname}'. Please choose a different name.`);
        }
        throw new Error(error.message);
    }
    return data[0];
  }
  
  /**
   * Retrieves a contact's wallet using their nickname.
   * @param {number} user_tg_id - Telegram ID of the user looking up the contact.
   * @param {string} nickname - The nickname of the contact.
   * @param {string} network - The network to get the wallet for.
   * @returns {Promise<Object|null>} The contact's wallet data or null if not found.
   */
  async getContactWallet(user_tg_id, nickname, network) {
    const { data: contactData, error: contactError } = await this.supabase
      .from('contacts')
      .select('contact_tg_id')
      .eq('user_tg_id', user_tg_id)
      .eq('nickname', nickname)
      .single();

    if (contactError || !contactData) {
        return null; // Contact not found
    }
    
    // Now get the wallet for that contact's telegram ID
    return this.getWallet(contactData.contact_tg_id, network);
  }

  /**
   * Updates a user's record with their Circle Business API IDs.
   * @param {number} tg_id - The user's Telegram ID.
   * @param {object} ids - An object containing the IDs to update.
   */
  async updateUserCircleIds(tg_id, { bank_account_id, recipient_address_id }) {
    const updateData = {};
    if (bank_account_id) updateData.circle_bank_account_id = bank_account_id;
    if (recipient_address_id) updateData.circle_recipient_address_id = recipient_address_id;

    const { error } = await this.supabase
      .from('users')
      .update(updateData)
      .eq('tg_id', tg_id);

    if (error) {
      console.error("Error updating user Circle IDs:", error);
      throw new Error(error.message);
    }
  }
}

module.exports = new SupabaseService();