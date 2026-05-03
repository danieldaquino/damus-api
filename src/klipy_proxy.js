const { json_response, error_response, invalid_request } = require('./server_helpers')
const { get_user_uuid } = require('./user_management')

const KLIPY_GIF_SEARCH_DEFAULT_FORMAT_FILTER = 'gif,webp,jpg,mp4,webm'
const KLIPY_FEATURED_DEFAULT_MEDIA_FILTER = 'gif,tinygif,mp4,tinymp4,webm,tinywebm'
const KLIPY_ALLOWED_CONTENT_FILTERS = new Set(['off', 'low', 'medium', 'high'])

function parse_integer_query_param(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? null : parsed
}

function append_if_present(search_params, key, value) {
  if (value === undefined || value === null || value === '') {
    return
  }

  search_params.append(key, String(value))
}

function get_klipy_base_url() {
  return process.env.KLIPY_API_BASE_URL || 'https://api.klipy.com'
}

function get_klipy_app_key(res) {
  const app_key = process.env.KLIPY_APP_KEY
  if (!app_key) {
    error_response(res, 'KLIPY_APP_KEY is not configured')
    return null
  }

  return app_key
}

async function proxy_klipy_request(res, upstream_url) {
  try {
    const upstream_response = await fetch(upstream_url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    const response_text = await upstream_response.text()
    let response_payload = null

    if (response_text.length > 0) {
      try {
        response_payload = JSON.parse(response_text)
      }
      catch (parse_error) {
        error_response(res, 'KLIPY returned a non-JSON response', 502)
        return
      }
    }

    if (!upstream_response.ok) {
      json_response(res, response_payload || { error: 'KLIPY request failed' }, upstream_response.status)
      return
    }

    json_response(res, response_payload || {}, upstream_response.status)
  }
  catch (request_error) {
    error_response(res, `Failed to reach KLIPY: ${request_error.message}`, 502)
  }
}

async function proxy_klipy_gif_search(app, req, res) {
  const app_key = get_klipy_app_key(res)
  if (!app_key) {
    return
  }

  const page = parse_integer_query_param(req.query.page, 1)
  if (page === null || page < 1) {
    invalid_request(res, 'Invalid page. Expected an integer >= 1')
    return
  }

  const per_page = parse_integer_query_param(req.query.per_page, 24)
  if (per_page === null || per_page < 8 || per_page > 50) {
    invalid_request(res, 'Invalid per_page. Expected an integer between 8 and 50')
    return
  }

  const query = req.query.q
  if (query !== undefined && typeof query !== 'string') {
    invalid_request(res, 'Invalid q. Expected a string')
    return
  }

  const locale = req.query.locale
  if (locale !== undefined && typeof locale !== 'string') {
    invalid_request(res, 'Invalid locale. Expected a string')
    return
  }

  const content_filter = req.query.content_filter
  if (content_filter !== undefined) {
    if (typeof content_filter !== 'string' || !KLIPY_ALLOWED_CONTENT_FILTERS.has(content_filter)) {
      invalid_request(res, 'Invalid content_filter. Expected one of: off, low, medium, high')
      return
    }
  }

  const format_filter = req.query.format_filter
  if (format_filter !== undefined && typeof format_filter !== 'string') {
    invalid_request(res, 'Invalid format_filter. Expected a comma-separated string')
    return
  }

  const customer_id = get_user_uuid(app, req.authorized_pubkey)
  const base_url = get_klipy_base_url()
  const search_params = new URLSearchParams()
  search_params.set('page', String(page))
  search_params.set('per_page', String(per_page))
  search_params.set('customer_id', customer_id)
  search_params.set('format_filter', format_filter || KLIPY_GIF_SEARCH_DEFAULT_FORMAT_FILTER)
  append_if_present(search_params, 'q', query)
  append_if_present(search_params, 'locale', locale)
  append_if_present(search_params, 'content_filter', content_filter)

  const upstream_url = `${base_url}/api/v1/${encodeURIComponent(app_key)}/gifs/search?${search_params.toString()}`
  await proxy_klipy_request(res, upstream_url)
}

async function proxy_klipy_gif_featured(req, res) {
  const app_key = get_klipy_app_key(res)
  if (!app_key) {
    return
  }

  const limit = parse_integer_query_param(req.query.limit, 20)
  if (limit === null || limit < 1 || limit > 50) {
    invalid_request(res, 'Invalid limit. Expected an integer between 1 and 50')
    return
  }

  const pos = req.query.pos
  if (pos !== undefined && typeof pos !== 'string') {
    invalid_request(res, 'Invalid pos. Expected a string')
    return
  }

  const locale = req.query.locale
  if (locale !== undefined && typeof locale !== 'string') {
    invalid_request(res, 'Invalid locale. Expected a string')
    return
  }

  const country = req.query.country
  if (country !== undefined && typeof country !== 'string') {
    invalid_request(res, 'Invalid country. Expected a string')
    return
  }

  const content_filter = req.query.contentfilter
  if (content_filter !== undefined) {
    if (typeof content_filter !== 'string' || !KLIPY_ALLOWED_CONTENT_FILTERS.has(content_filter)) {
      invalid_request(res, 'Invalid contentfilter. Expected one of: off, low, medium, high')
      return
    }
  }

  const media_filter = req.query.media_filter
  if (media_filter !== undefined && typeof media_filter !== 'string') {
    invalid_request(res, 'Invalid media_filter. Expected a comma-separated string')
    return
  }

  const base_url = get_klipy_base_url()
  const search_params = new URLSearchParams()
  search_params.set('key', app_key)
  search_params.set('limit', String(limit))
  search_params.set('media_filter', media_filter || KLIPY_FEATURED_DEFAULT_MEDIA_FILTER)
  append_if_present(search_params, 'pos', pos)
  append_if_present(search_params, 'locale', locale)
  append_if_present(search_params, 'country', country)
  append_if_present(search_params, 'contentfilter', content_filter)

  const upstream_url = `${base_url}/v2/featured?${search_params.toString()}`
  await proxy_klipy_request(res, upstream_url)
}

module.exports = {
  proxy_klipy_gif_search,
  proxy_klipy_gif_featured,
}
