/**
 * Audit trail: GET /audit (list, server-side pagination from
 * GET /audit/pagination) and GET /audit/:id (one entry with its details,
 * e.g. the snapshot of a permanently deleted document). Read-only: entries
 * are written by services/audit.js and never edited or removed through the UI.
 */
const express = require('express');
const router = express.Router();
const AuditLog = require('../models/auditlog');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  const query = Object.assign({ order: 'desc' }, request.query);
  response.json(await pagination.paginatedResponse(query, datasets.auditlogs));
});

router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('audit/index', { targetId: request.query.target || '' });
});

router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const entry = await middleware.findByIdOr404(
    AuditLog,
    request.params.id,
    response,
    'Audit entry',
    '/audit'
  );
  if (!entry) return;
  if (request.accepts(['html', 'json']) === 'json') {
    return response.json(entry);
  }
  response.render('audit/show', {
    entry,
    detailsJson: JSON.stringify(entry.details === undefined ? {} : entry.details, null, 2),
  });
});

module.exports = router;
