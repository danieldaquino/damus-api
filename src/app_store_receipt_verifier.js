"use strict";
// @ts-check
/**
 * @typedef {import('@apple/app-store-server-library').JWSTransactionDecodedPayload} JWSTransactionDecodedPayload
 */
/**
 * @typedef {import('./transaction_management.js').Transaction} Transaction
 */

const { AppStoreServerAPIClient, Environment, ReceiptUtility, Order, ProductType, SignedDataVerifier } = require("@apple/app-store-server-library")
const { current_time } = require("./utils")
const fs = require('fs')
const debug = require('debug')('api:iap')

const DEFAULT_ROOT_CA_DIR = './apple-root-ca'
/**
 * Mock transaction history for testing purposes.
 * @type {Transaction[]}
 */
const MOCK_TRANSACTION_HISTORY = [{
  type: "iap",
  id: "1",
  start_date: current_time(),
  end_date: current_time() + 365 * 24 * 60 * 60,
  purchased_date: current_time(),
  duration: null
}];

/**
 * Verifies the receipt data and returns the expiry date if the receipt is valid.
 *
 * @param {string} receipt_data - The receipt data to verify in base64 format.
 * @param {string} authenticated_account_token - The UUID account token of the user who is authenticated in this request.
 *
 * @returns {Promise<Transaction[]|null>} The validated transactions
 */
async function verify_receipt(receipt_data, authenticated_account_token) {
    debug("Verifying receipt with authenticated account token: %s", authenticated_account_token);
    // Mocking logic for testing purposes
    if (process.env.MOCK_VERIFY_RECEIPT == "true") {
        debug("Mocking verify_receipt with expiry date 30 days from now");
        return MOCK_TRANSACTION_HISTORY;
    }

    // Setup the environment and client
    const rootCaDir = process.env.IAP_ROOT_CA_DIR || DEFAULT_ROOT_CA_DIR;
    const bundleId = process.env.IAP_BUNDLE_ID;
    const environment = getAppStoreEnvironmentFromEnv();
    const client = createAppStoreServerAPIClientFromEnv();
    
    // Get the transaction ID from the receipt
    const transactionId = extractTransactionIdFromAppReceipt(receipt_data);
    debug("[Account token: %s] Transaction ID extracted from the receipt: %s", authenticated_account_token, transactionId);

    // If the transaction ID is present, fetch the transaction history, verify the transactions, and return the latest expiry date
    if (transactionId != null) {
        return await fetchValidatedTransactions(client, transactionId, rootCaDir, environment, bundleId, authenticated_account_token);
    }
    return Promise.resolve(null);
}

/**
 * Verifies the transaction id and returns the verified transaction history if valid
 *
 * @param {number} transaction_id - The transaction id to verify.
 * @param {string} authenticated_account_token - The UUID account token of the user who is authenticated in this request.
 *
 * @returns {Promise<Transaction[]|null>} The validated transactions
 */
async function verify_transaction_id(transaction_id, authenticated_account_token) {
    debug("Verifying transaction id '%d' with authenticated account token: %s", transaction_id, authenticated_account_token);
    // Mocking logic for testing purposes
    if (process.env.MOCK_VERIFY_RECEIPT == "true") {
        debug("Mocking verify_receipt with expiry date 30 days from now");
        return MOCK_TRANSACTION_HISTORY;
    }

    // Setup the environment and client
    const rootCaDir = process.env.IAP_ROOT_CA_DIR || DEFAULT_ROOT_CA_DIR;
    const bundleId = process.env.IAP_BUNDLE_ID;
    const environment = getAppStoreEnvironmentFromEnv();
    const client = createAppStoreServerAPIClientFromEnv();

    // If the transaction ID is present, fetch the transaction history, verify the transactions, and return the latest expiry date
    if (transaction_id != null) {
        return await fetchValidatedTransactions(client, transaction_id, rootCaDir, environment, bundleId, authenticated_account_token);
    }
    return Promise.resolve(null);
}


/**
 * Looks up the order id and returns the verified transaction history if valid
 *
 * @param {string} order_id - The order id to lookup
 *
 * @returns {Promise<Transaction[]|null>} The validated transactions
 */
async function lookup_order_id(order_id) {
  debug("Looking up order id '%d'", order_id);
  // Mocking logic for testing purposes
  if (process.env.MOCK_VERIFY_RECEIPT == "true") {
      debug("Mocking verify_receipt with expiry date 30 days from now");
      return MOCK_TRANSACTION_HISTORY;
  }

  // Setup the environment and client
  const rootCaDir = process.env.IAP_ROOT_CA_DIR || DEFAULT_ROOT_CA_DIR;
  const bundleId = process.env.IAP_BUNDLE_ID;
  const environment = getAppStoreEnvironmentFromEnv();
  const client = createAppStoreServerAPIClientFromEnv();

  // If the transaction ID is present, fetch the transaction history, verify the transactions, and return the latest expiry date
  if (order_id != null) {
      return await fetchValidatedTransactionsFromOrderId(client, order_id, rootCaDir, environment, bundleId, undefined);
  }
  return Promise.resolve(null);
}


/**
 * Fetches transaction history with the App Store API, verifies the transactions, and returns formatted transactions.
 * It also verifies if the transaction belongs to the account who made the request.
 *
 * @param {AppStoreServerAPIClient} client - The App Store API client.
 * @param {string} transactionId - The transaction ID to fetch history for.
 * @param {string} rootCaDir - The directory containing Apple root CA certificates for verification.
 * @param {Environment} environment - The App Store environment.
 * @param {string} bundleId - The bundle ID of the app.
 * @param {string} authenticatedAccountToken - The UUID account token of the user who is authenticated in this request.

 * @returns {Promise<Transaction[]|null>} The validated transactions
*/
async function fetchValidatedTransactions(client, transactionId, rootCaDir, environment, bundleId, authenticatedAccountToken) {
  const transactions = await fetchTransactionHistory(client, transactionId);
  debug("[Account token: %s] Fetched transaction history for transaction ID: %s; Found %d transactions", authenticatedAccountToken, transactionId, transactions.length);
  const rootCAs = readCertificateFiles(rootCaDir);
  const decodedTransactions = await verifyAndDecodeTransactions(transactions, rootCAs, environment, bundleId);
  debug("[Account token: %s] Verified and decoded %d transactions", authenticatedAccountToken, decodedTransactions.length);
  const validDecodedTransactions = filterTransactionsThatBelongToAccount(decodedTransactions, authenticatedAccountToken);
  debug("[Account token: %s] Filtered transactions that belong to the account UUID. Found %d matching transactions", authenticatedAccountToken, validDecodedTransactions.length);
  if (validDecodedTransactions.length === 0) {
    return null;
  }
  return validDecodedTransactions.map((decodedTransaction) => {
    return transformDecodedTransactionToTransaction(decodedTransaction)
  })
}

/**
 * Fetches transaction history associated with an Order ID with the App Store API, verifies the transactions, and returns formatted transactions.
 * An Order ID is a unique identifier for a transaction that is generated by the App Store and is included in receipt emails, so it is useful for customer support.
 *
 * @param {AppStoreServerAPIClient} client - The App Store API client.
 * @param {string} orderId - The order ID to fetch history for.
 * @param {string} rootCaDir - The directory containing Apple root CA certificates for verification.
 * @param {Environment} environment - The App Store environment.
 * @param {string} bundleId - The bundle ID of the app.
 * @param {string | undefined} authenticatedAccountToken - The UUID account token of the user who is authenticated in this request. If undefined, UUID authentication will be skipped.
 *
 * @returns {Promise<Transaction[]|null>} The validated transactions
*/
async function fetchValidatedTransactionsFromOrderId(client, orderId, rootCaDir, environment, bundleId, authenticatedAccountToken) {
  const transactions = await client.lookUpOrderId(orderId);
  debug("[Order ID: %s] Fetched transaction history; Found %d transactions", orderId, transactions.signedTransactions);
  const rootCAs = readCertificateFiles(rootCaDir);
  const decodedTransactions = await verifyAndDecodeTransactions(transactions.signedTransactions, rootCAs, environment, bundleId);
  debug("[Order ID: %s] Verified and decoded %d transactions", orderId, decodedTransactions.length);
  const validDecodedTransactions = authenticatedAccountToken == undefined ? decodedTransactions : filterTransactionsThatBelongToAccount(decodedTransactions, authenticatedAccountToken);
  if (authenticatedAccountToken != undefined) {
    debug("[Account token: %s] Filtered transactions that belong to the account UUID. Found %d matching transactions", authenticatedAccountToken, validDecodedTransactions.length);
  }
  if (validDecodedTransactions.length === 0) {
    return null;
  }
  return validDecodedTransactions.map((decodedTransaction) => {
    return transformDecodedTransactionToTransaction(decodedTransaction)
  })
}

/**
 * Transforms a JWSTransactionDecodedPayload into a Transaction object
 * 
 * @param {JWSTransactionDecodedPayload} decodedTransaction - The decoded transaction to transform.
 * @returns {Transaction} The transformed transaction.
 * 
 */
function transformDecodedTransactionToTransaction(decodedTransaction) {
  return {
    type: "iap",
    id: decodedTransaction.transactionId,
    start_date: decodedTransaction.purchaseDate / 1000,
    end_date: decodedTransaction.expiresDate / 1000,
    purchased_date: decodedTransaction.purchaseDate / 1000,
    duration: null
  }
}

/**
  * Filters out transactions that do not belong to the authorized account token.
  *
  * @param {Array<JWSTransactionDecodedPayload>} transactions - The transactions to filter.
  * @param {string} authenticatedAccountToken - The UUID account token of the user who is authenticated in this request.
  *
  * @returns {Array<JWSTransactionDecodedPayload>} The transactions that belong to the authorized account token.
  */
function filterTransactionsThatBelongToAccount(transactions, authenticatedAccountToken) {
  return transactions.filter((transaction) => {
    const txToken = transaction.appAccountToken.toUpperCase();
    const authAccountToken = authenticatedAccountToken.toUpperCase();
    debug("Comparing transaction account token: %s with authenticated account token: %s", txToken, authAccountToken);
    return txToken === authAccountToken;
  })
}

const certificateCache = new Map();
/**
* Reads all certificate files from a directory.
*
* @param {string} directory - The directory containing certificate files.
* @returns {Buffer[]} An array of certificate file contents.
*/
function readCertificateFiles(directory) {
    const files = fs.readdirSync(directory);
    return files.map((fileName) => {
        const filePath = `${directory}/${fileName}`;
        if (!certificateCache.has(filePath)) {
            const fileContents = fs.readFileSync(filePath);
            certificateCache.set(filePath, fileContents);
        }
        return certificateCache.get(filePath);
    });
}

/**
 * Verifies and decodes a list of signed transactions.
 *
 * @param {string[]} transactions - The signed transactions to verify and decode.
 * @param {Buffer[]} rootCAs - Apple root CA certificate contents for verification.
 * @param {Environment} environment - The App Store environment.
 * @param {string} bundleId - The bundle ID of the app.
 * @returns {Promise<JWSTransactionDecodedPayload[]>} The decoded transactions.
 */
async function verifyAndDecodeTransactions(transactions, rootCAs, environment, bundleId) {
    const verifier = new SignedDataVerifier(rootCAs, true, environment, bundleId);
    let decodedTransactions = [];
    for (let transaction of transactions) {
        const decodedTransaction = await verifier.verifyAndDecodeTransaction(transaction);
        decodedTransactions.push(decodedTransaction);
    }
    return decodedTransactions;
}

/**
 * Fetches the transaction history for a given transaction ID.
 *
 * @param {AppStoreServerAPIClient} client - The App Store API client.
 * @param {string} transactionId - The transaction ID to fetch history for.
 * @returns {Promise<Object[]>} The transaction history.
 */
async function fetchTransactionHistory(client, transactionId) {
    // TODO: In the future we might need to make this query more specific to fetch only Purple-related products.
    const transactionHistoryRequest = {
        sort: Order.ASCENDING,
        revoked: false,
        productTypes: [ProductType.AUTO_RENEWABLE]
    };
    let response = null;
    let transactions = [];
    do {
        const revisionToken = response !== null && response.revision !== null ? response.revision : null;
        try {
          response = await client.getTransactionHistory(transactionId, revisionToken, transactionHistoryRequest);
          if (response.signedTransactions) {
              transactions = transactions.concat(response.signedTransactions);
              continue;
          }
        } catch (error) {
          debug("Error fetching IAP transaction history due to an error: %o", error);
          break;
        }
    } while (response.hasMore);
    return transactions;
}

/**
 * Extracts the transaction ID from the app receipt.
 * 
 * @param {string} receipt_data - The receipt data to extract the transaction ID from. (In base64 format)
*/
function extractTransactionIdFromAppReceipt(receipt_data) {
  const receiptUtil = new ReceiptUtility();
  try {
    const transactionId = receiptUtil.extractTransactionIdFromAppReceipt(receipt_data);
    return transactionId;
  }
  catch (error) {
    return null;
  }
}

/**
 * Instantiates an AppStoreServerAPIClient with the environment variables as configuration.
 * 
 * @returns {AppStoreServerAPIClient} The App Store API client.
*/
function createAppStoreServerAPIClientFromEnv() {
  const issuerId = process.env.IAP_ISSUER_ID;
  const keyId = process.env.IAP_KEY_ID;
  const bundleId = process.env.IAP_BUNDLE_ID;
  const filePath = process.env.IAP_PRIVATE_KEY_PATH;
  const encodedKey = fs.readFileSync(filePath, "utf8");
  const environment = getAppStoreEnvironmentFromEnv();

  return new AppStoreServerAPIClient(encodedKey, keyId, issuerId, bundleId, environment);
}

/** 
 * Gets the App Store environment from the environment variables.
 * 
 * @returns {Environment} The App Store environment.
*/
function getAppStoreEnvironmentFromEnv() {
  return process.env.IAP_ENVIRONMENT === "Sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
}

module.exports = {
    verify_receipt, verify_transaction_id, lookup_order_id
};
