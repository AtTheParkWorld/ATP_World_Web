/**
 * Daily WhatsApp message (services/whatsappDigest.js).
 *   GET  /api/whatsapp-digest/tomorrow   public — tomorrow's public sessions
 *                                        as the ready-to-post message (the
 *                                        app fetches it when the push is tapped)
 *   GET  /api/whatsapp-digest/admin      admin — preview + settings
 *   PATCH /api/whatsapp-digest/admin     admin — enabled / time / recipients
 *   POST /api/whatsapp-digest/admin/send admin — push it now (to me, or to all)
 */
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const digest = require('../services/whatsappDigest');

router.get('/tomorrow', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await digest.buildDigest());
  } catch (err) { next(err); }
});

router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [preview, settings, recipients] = await Promise.all([
      digest.buildDigest(), digest.getSettings(), digest.recipientIds(),
    ]);
    res.json({ preview, settings, recipient_count: recipients.length });
  } catch (err) { next(err); }
});

router.patch('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { enabled, time, recipients } = req.body || {};
    res.json({ settings: await digest.updateSettings({ enabled, time, recipients }, req.member.id) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/admin/send', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const toAll = !!(req.body && req.body.to_all);
    res.json(await digest.sendDigest({ only: toAll ? null : req.member.id }));
  } catch (err) { next(err); }
});

module.exports = router;
