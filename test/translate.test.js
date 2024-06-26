const tap = require('tap');
const express = require('express');
const sinon = require('sinon');
const nostr = require('nostr');
const { config_router } = require('../src/router_config');
const current_time = require('../src/utils').current_time;
const { supertest_client, TEST_BASE_URL } = require('./controllers/utils');


const TRANSLATION_PROVIDER = process.env.TRANSLATION_PROVIDER

// MARK: - Tests

tap.test(`translate_payload - Existing translation in database (${TRANSLATION_PROVIDER})`, async (t) => {
  const api = await generate_test_api(t, {
    simulate_existing_translation_in_db: "<EXISTING_TRANSLATION>",
    simulate_account_found_in_db: true,
  });

  const test_data = await generate_test_request_data(api);
  const expected_result = {
    text: "<EXISTING_TRANSLATION>",
  };

  const res = await api.test_request
    .get(test_data.query_url)
    .set('Authorization', 'Nostr ' + test_data.auth_note_base64)

  t.same(res.statusCode, 200, 'Response should be 200');
  t.same(res.body, expected_result, 'Response should match expected value');
  t.end();
});

tap.test(`translate_payload - reject json data (${TRANSLATION_PROVIDER} server)`, async (t) => {
  const api = await generate_test_api(t, {
    simulate_existing_translation_in_db: false,
    simulate_account_found_in_db: true,
  });

  const payload = JSON.stringify({"hello": 1})
  const expected_result = {
    error: "payload is data",
  };

  const url = `/translate?source=EN&target=JA&q=${encodeURIComponent(payload)}`
  const test_data = await generate_test_request_data(api, url)

  const res = await api.test_request
    .get(url)
    .set('Authorization', 'Nostr ' + test_data.auth_note_base64)

  t.same(res.statusCode, 400, 'Response should be 400');
  t.same(res.body, expected_result, 'Response should match expected value');
})

tap.test(`translate_payload - New translation (${TRANSLATION_PROVIDER} server)`, async (t) => {
  const api = await generate_test_api(t, {
    simulate_existing_translation_in_db: false,
    simulate_account_found_in_db: true,
  });

  const expected_text = "Mock translation";

  // Create a stub for fetch
  let fetchStub = null

  switch (TRANSLATION_PROVIDER) {
    case "deepl": {
      fetchStub = sinon.stub(global, 'fetch').returns(Promise.resolve({
        json: async () => {
          return {
            translations: [
              {text: expected_text}
            ]
          };
        },
        ok: true
      }));
      break
    }
    case "noswhere": {
      sinon.stub(global, 'fetch').returns(Promise.resolve({
        json: async () => {
          return {
            result: expected_text,
          };
        },
        ok: true
      }));
      break
    }
  }

  const test_data = await generate_test_request_data(api);

  const res = await api.test_request
    .get(test_data.query_url)
    .set('Authorization', 'Nostr ' + test_data.auth_note_base64)

  t.same(res.statusCode, 200, 'Response should be 200');
  t.same(res.body, {text: expected_text}, 'Response should match expected value');

  // Restore fetch
  fetchStub?.restore();

  t.end();
});

tap.test(`translate - Account not found (${TRANSLATION_PROVIDER})`, async (t) => {
  const api = await generate_test_api(t, {
    simulate_existing_translation_in_db: false,
    simulate_account_found_in_db: false,
  });
  const test_data = await generate_test_request_data(api);
  const res = await api.test_request
    .get(test_data.query_url)
    .set('Authorization', 'Nostr ' + test_data.auth_note_base64)
  t.same(res.statusCode, 401, 'Response should be 401');
  t.end();
});

tap.test(`translate - Account expired (${TRANSLATION_PROVIDER})`, async (t) => {
  const api = await generate_test_api(t, {
    simulate_existing_translation_in_db: false,
    simulate_account_expired: true,
  });
  const test_data = await generate_test_request_data(api);
  const res = await api.test_request
    .get(test_data.query_url)
    .set('Authorization', 'Nostr ' + test_data.auth_note_base64)
  t.same(res.statusCode, 401, 'Response should be 401');
  t.end();
});


// MARK: - Helpers


async function generate_test_api(t, config) {
  const api = {
    router: express(),
    translation: {
      queue: {},
    },
    dbs: {
      translations: {
        get: (trans_id) => {
          if (config.simulate_existing_translation_in_db) {
            // Simulate existing translation in the database
            return {
              text: config.simulate_existing_translation_in_db,
            };
          } else {
            // Simulate translation not found in the database
            return null;
          }
        },
        put: () => { },
      },
      accounts: {
        get: (id) => {
          if (config.simulate_account_found_in_db) {
            // Simulate account found in the database
            return {
              expiry: current_time() + 60 * 60 * 24 * 30 * 1000 // 30 days
            };
          }
          else if (config.simulate_account_expired) {
            // Simulate account found in the database
            return {
              expiry: current_time() - 60 * 60 * 24 * 30 * 1000 // 30 days ago
            };
          }
          else {
            // Simulate account not found in the database
            return null;
          }
        },
      },
      pubkeys_to_user_ids: {
        get: (pubkey) => {
          return 1;
        },
        put: (pubkey, user_id) => { },
      },
    },
    web_auth_manager: {
      require_web_auth: async (req, res, next) => {
        req.authorized_pubkey = 'abc123';
        next();
      }
    }
  };

  config_router(api);

  api.test_request = await supertest_client(api.router, t);

  return api;
}

async function generate_test_request_data(api, q) {
  let test_privkey = '10a9842fadc0aae2a649a1b707bf97e48c787b8517af4728ba3ec304089451be';
  let test_pubkey = nostr.getPublicKey(test_privkey);

  let query_url = q || '/translate?source=EN&target=JA&q=Hello'
  let full_query_url = api.router.base_url + query_url;

  let auth_note_template = {
    pubkey: test_pubkey,
    created_at: current_time(),
    kind: 27235,
    tags: [
      ["u", full_query_url],
      ["method", "GET"],
    ],
    content: '',
  }

  let auth_note_id = await nostr.calculateId(auth_note_template);
  let auth_note_sig = await nostr.signId(test_privkey, auth_note_id);
  let auth_note = {
    ...auth_note_template,
    id: auth_note_id,
    sig: auth_note_sig
  }
  let auth_note_base64 = Buffer.from(JSON.stringify(auth_note)).toString('base64');

  return {
    auth_note_base64,
    query_url,
    full_query_url,
  };
}

