const test = require('tap').test;
const express = require('express');
const config_router = require('../src/router_config.js').config_router;
const nostr = require('nostr');
const current_time = require('../src/utils.js').current_time;
const { supertest_client } = require('./utils.js');

test('config_router - Account management routes', async (t) => {
  const account_info = {
    pubkey: 'abc123',
    created_at: Date.now() - 60 * 60 * 24 * 30 * 1000, // 30 days ago
    expiry: Date.now() + 60 * 60 * 24 * 30 * 1000 // 30 days
  };
  const pubkeys_to_user_ids = {
    'abc123': 1
  };
  const accounts = {
    1: account_info
  }

  const app = {
    router: express(),
    dbs: {
      accounts: {
        get: (id) => {
          return accounts[id]
        },
        put: (id, account) => {
          accounts[id] = account
        },
        getKeys: (options) => {
          if (options && options.reverse) {
            return Object.keys(accounts).reverse()
          }
          return Object.keys(accounts)
        }
      },
      pubkeys_to_user_ids: {
        get: (pubkey) => {
          return pubkeys_to_user_ids[pubkey]
        },
        put: (pubkey, user_id) => {
          pubkeys_to_user_ids[pubkey] = user_id
        },
        getKeys: (options) => {
          if (options.reverse) {
            return Object.keys(pubkeys_to_user_ids).reverse()
          }
          return Object.keys(pubkeys_to_user_ids)
        }
      }

    }
  };

  const request = await supertest_client(app.router, t);

  config_router(app);

  t.test('should handle a valid GET request for an existing account ', async (t) => {
    const res = await request
      .get('/accounts/abc123')
      .expect(200);

    const expectedData = {
      pubkey: account_info.pubkey,
      created_at: account_info.created_at,
      subscriber_number: 1,
      expiry: account_info.expiry,
      active: true,
    };
    t.same(res.body, expectedData, 'Response should match expected value');
    t.end();
  });

  t.end();
});
