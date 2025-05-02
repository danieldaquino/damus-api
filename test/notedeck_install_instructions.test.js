"use strict";
// @ts-check

const test = require('tap').test;
const { PurpleTestController } = require('./controllers/purple_test_controller.js');
const { PURPLE_ONE_MONTH } = require('../src/invoicing.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const PREMIUM_INSTRUCTIONS = 'premium'
const FREE_INSTRUCTIONS = 'free'

function get_notedeck_instructions(purple_test_controller, instruction_type) {
  const installInstructionsPath = instruction_type == PREMIUM_INSTRUCTIONS ? path.resolve(purple_test_controller.env.NOTEDECK_INSTALL_PREMIUM_MD) : path.resolve(purple_test_controller.env.NOTEDECK_INSTALL_MD);
  return fs.readFileSync(installInstructionsPath, { encoding: 'utf8' });
}

test('Notedeck free install instructions flow', async (t) => {
  // Initialize the PurpleTestController
  const purple_api_controller = await PurpleTestController.new(t);

  // Instantiate a new client
  const user_pubkey_1 = purple_api_controller.new_client();

  const notedeck_install_response = await purple_api_controller.clients[user_pubkey_1].get_notedeck_install_instructions()
  t.same(notedeck_install_response.statusCode, 200);
  t.same(notedeck_install_response.body.value, get_notedeck_instructions(purple_api_controller, FREE_INSTRUCTIONS));

  t.end();
});

test('Notedeck premium install instructions flow', async (t) => {
  // Initialize the PurpleTestController
  const purple_api_controller = await PurpleTestController.new(t);

  // Instantiate a new client
  const user_pubkey_1 = purple_api_controller.new_client();

  // Let's get them an account
  await purple_api_controller.ln_flow_buy_subscription(user_pubkey_1, PURPLE_ONE_MONTH);

  // Get the account info
  const response = await purple_api_controller.clients[user_pubkey_1].get_account();
  t.same(response.statusCode, 200);

  // Let's login to get a session token
  // (We could probably get it from the ln subscription flow part, but we are not testing that here, so it's fine)
  let session_token = await purple_api_controller.login(user_pubkey_1);

  const notedeck_install_response = await purple_api_controller.clients[user_pubkey_1].get_notedeck_install_instructions({ session_token: session_token })
  t.same(notedeck_install_response.statusCode, 200);
  t.same(notedeck_install_response.body.value, get_notedeck_instructions(purple_api_controller, PREMIUM_INSTRUCTIONS));

  t.end();
});

test('Notedeck unauthorized premium install instructions flow', async (t) => {
  // Initialize the PurpleTestController
  const purple_api_controller = await PurpleTestController.new(t);

  // Instantiate a new client but don't get an account
  const user_pubkey_1 = purple_api_controller.new_client();

  // Get the account info
  const response = await purple_api_controller.clients[user_pubkey_1].get_account();
  t.same(response.statusCode, 404);

  const notedeck_install_response = await purple_api_controller.clients[user_pubkey_1].get_notedeck_install_instructions({ session_token: "fakesessiontoken" })
  t.same(notedeck_install_response.statusCode, 200);
  t.same(notedeck_install_response.body.value, get_notedeck_instructions(purple_api_controller, FREE_INSTRUCTIONS));

  t.end();
});


test('Notedeck expired account install instructions flow', async (t) => {
  // Initialize the PurpleTestController
  const purple_api_controller = await PurpleTestController.new(t);
  purple_api_controller.set_current_time(1706659200)  // 2024-01-31 00:00:00 UTC

  // Instantiate a new client
  const user_pubkey_1 = purple_api_controller.new_client();

  const initial_account_info_response = await purple_api_controller.clients[user_pubkey_1].get_account();
  t.same(initial_account_info_response.statusCode, 404);

  // Buy a one month subscription
  await purple_api_controller.ln_flow_buy_subscription(user_pubkey_1, PURPLE_ONE_MONTH);

  // Check expiry
  const account_info_response_1 = await purple_api_controller.clients[user_pubkey_1].get_account();
  t.same(account_info_response_1.statusCode, 200);
  t.same(account_info_response_1.body.expiry, purple_api_controller.current_time() + 30 * 24 * 60 * 60);
  t.same(account_info_response_1.body.active, true);

  // Move time forward by 35 days, and make sure the account is not active anymore
  purple_api_controller.set_current_time(purple_api_controller.current_time() + 35 * 24 * 60 * 60);
  const account_info_response_2 = await purple_api_controller.clients[user_pubkey_1].get_account();
  t.same(account_info_response_2.statusCode, 200);
  t.same(account_info_response_2.body.active, false);

  let session_token = await purple_api_controller.login(user_pubkey_1);

  // Now try to get notedeck instructions
  const notedeck_install_response = await purple_api_controller.clients[user_pubkey_1].get_notedeck_install_instructions({ session_token: session_token })
  t.same(notedeck_install_response.statusCode, 200);
  t.same(notedeck_install_response.body.value, get_notedeck_instructions(purple_api_controller, FREE_INSTRUCTIONS));

  t.end();
});
