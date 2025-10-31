const { createClient } = require("@supabase/supabase-js");
const config = require("../config/index.js");

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
  async getWallet(tgId, network) {
    //console.log("supaServ getting wallet from Supabase:", tg_id, " network:",network);
    this.recipientId = process.env.TG_ID_RECIPIENT;
    //const tg_id = this.recipientId; // tgId;
    const tg_id = tgId;
    const { data, error } = await this.supabase
      .from('wallets')
      .select('walletid, walletaddress')
      .eq('tg_id', tg_id)
      .eq('network', network)
      .single(); // .single() returns one record or null, which is perfect for us.

    if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found, which is not an error for us.
      console.error("Error getting wallet from Supabase:", error);
      throw new Error(error.message);
    }

    console.log("supaServ getting wallet from Supabase data:", data);

    // Map database columns to the structure our app expects { walletId, address }
    if (data) {
        return {
            walletid: data.walletid,
            address: data.walletaddress
        };
    }

    return null;
  }
}

module.exports = new SupabaseService();