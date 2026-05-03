const test = require('tap').test;
const express = require('express');
const config_router = require('../src/router_config.js').config_router;
const nostr = require('nostr');
const current_time = require('../src/utils.js').current_time;
const { supertest_client } = require('./controllers/utils.js');
const { v4: uuidv4 } = require('uuid')
const { PurpleTestController } = require('./controllers/purple_test_controller.js')

test('config_router - Account management routes', async (t) => {
  const account_info = {
    pubkey: 'abc123',
    created_at: current_time() - 60 * 60 * 24 * 30, // 30 days ago
    expiry: current_time() + 60 * 60 * 24 * 30 // 30 days
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
      },
      pubkeys_to_user_uuids: {
        get: (pubkey) => {
          return uuidv4()
        },
        put: (pubkey, user_uuid) => {
          return
        },
        getKeys: (options) => {
          return Object.keys(pubkeys_to_user_ids)
        }
      }

    },
    web_auth_manager: {
      require_web_auth: async (req, res, next) => {
        req.authorized_pubkey = 'abc123';
        next();
      },
      use_web_auth: async (req, res, next) => {
        req.authorized_pubkey = 'abc123';
        next();
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
      testflight_url: null,
      attributes: {
        member_for_more_than_one_year: false
      }
    };
    t.same(res.body, expectedData, 'Response should match expected value');
    t.end();
  });

  t.end();
});

test('config_router - GIF search proxy requires active Purple and proxies search params', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  const original_fetch = global.fetch
  global.fetch = async (url, options) => {
    t.equal(url, 'https://api.klipy.test/api/v1/test-klipy-app-key/gifs/search?page=2&per_page=8&customer_id=TEST-UUID-123&format_filter=gif%2Cmp4&q=hello&locale=us&content_filter=low')
    t.same(options, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        result: true,
        data: {
          data: [
            { id: 1, slug: 'hello-hi-662', title: 'Hello' }
          ],
          current_page: 2,
          per_page: 8,
          has_next: false
        }
      })
    }
  }

  t.teardown(() => {
    global.fetch = original_fetch
  })

  purple_api_controller.set_account_uuid(pubkey, 'TEST-UUID-123')
  await purple_api_controller.ln_flow_buy_subscription(pubkey, 'purple_one_month')

  const response = await purple_api_controller.clients[pubkey].search_gifs({
    q: 'hello',
    page: 2,
    per_page: 8,
    locale: 'us',
    content_filter: 'low',
    format_filter: 'gif,mp4'
  })

  t.equal(response.statusCode, 200)
  t.same(response.body, {
    result: true,
    data: {
      data: [
        { id: 1, slug: 'hello-hi-662', title: 'Hello' }
      ],
      current_page: 2,
      per_page: 8,
      has_next: false
    }
  })

})

test('config_router - GIF search proxy rejects inactive Purple users', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  const response = await purple_api_controller.clients[pubkey].search_gifs({ q: 'hello' })

  t.equal(response.statusCode, 401)
  t.same(response.body, { error: 'Account not found' })
})

test('config_router - GIF search proxy requires NIP-98 auth', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  await purple_api_controller.ln_flow_buy_subscription(pubkey, 'purple_one_month')

  const response = await purple_api_controller.clients[pubkey].search_gifs({ q: 'hello' }, { nip98_authenticated: false })

  t.equal(response.statusCode, 401)
  t.same(response.body, { error: 'Nostr authorization header missing' })
})

test('config_router - GIF featured proxy requires active Purple and proxies params', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  const original_fetch = global.fetch
  global.fetch = async (url, options) => {
    t.equal(url, 'https://api.klipy.test/v2/featured?key=test-klipy-app-key&limit=10&media_filter=tinygif%2Ctinymp4&pos=next-cursor&locale=en_US&country=US&contentfilter=medium')
    t.same(options, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        locale: 'en',
        results: [
          { id: '5985319072776906', title: 'Spongebob Squarepants Christmas Dance' }
        ],
        next: 'Mg=='
      })
    }
  }

  t.teardown(() => {
    global.fetch = original_fetch
  })

  await purple_api_controller.ln_flow_buy_subscription(pubkey, 'purple_one_month')

  const response = await purple_api_controller.clients[pubkey].featured_gifs({
    limit: 10,
    pos: 'next-cursor',
    locale: 'en_US',
    country: 'US',
    contentfilter: 'medium',
    media_filter: 'tinygif,tinymp4'
  })

  t.equal(response.statusCode, 200)
  t.same(response.body, {
    locale: 'en',
    results: [
      { id: '5985319072776906', title: 'Spongebob Squarepants Christmas Dance' }
    ],
    next: 'Mg=='
  })
})

test('config_router - GIF featured proxy rejects inactive Purple users', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  const response = await purple_api_controller.clients[pubkey].featured_gifs()

  t.equal(response.statusCode, 401)
  t.same(response.body, { error: 'Account not found' })
})

test('config_router - GIF featured proxy requires NIP-98 auth', async (t) => {
  const purple_api_controller = await PurpleTestController.new(t)
  const pubkey = purple_api_controller.new_client()

  await purple_api_controller.ln_flow_buy_subscription(pubkey, 'purple_one_month')

  const response = await purple_api_controller.clients[pubkey].featured_gifs({}, { nip98_authenticated: false })

  t.equal(response.statusCode, 401)
  t.same(response.body, { error: 'Nostr authorization header missing' })
})
