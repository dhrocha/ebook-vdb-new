const {
  resolvePdfSource,
  SENDGRID_API_KEY,
  IS_VERCEL,
  sendJson,
} = require('../lib/shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
  }

  try {
    const source = await resolvePdfSource();
    return sendJson(res, 200, {
      ok: true,
      pdf: source.type,
      sendgrid: Boolean(SENDGRID_API_KEY),
      vercel: IS_VERCEL,
    });
  } catch (err) {
    return sendJson(res, 503, { ok: false, error: err.message });
  }
};
