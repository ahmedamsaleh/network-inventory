const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const Link = require('../models/link');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /links/pagination?limit&offset&search&sort&order
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.links));
});
//INDEX - the link list is loaded by the table from /links/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('links/index');
});

//NEW - show form to create new Link
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('links/new', { types: Link.LINK_TYPES });
});

/** "not a number" speeds are reported like any other validation problem */
function speedError(fields) {
  return fields.speed !== undefined && fields.speed !== null && !Number.isFinite(fields.speed)
    ? 'Speed must be a number of bit/s'
    : null;
}

//CREATE - add new link to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const fields = Link.normalizeInput(request.body.link || {});
  const invalidSpeed = speedError(fields);
  if (invalidSpeed) {
    request.flash('error', invalidSpeed);
    return response.redirect('/links/new');
  }
  let createdLink;
  try {
    createdLink = await Link.create(
      Object.assign(fields, { author: { id: request.user._id, email: request.user.email } })
    );
  } catch (error) {
    // validation problems are user input: tell the user and return to the form
    request.flash('error', middleware.describeError(error));
    return response.redirect('/links/new');
  }
  request.flash(
    'success',
    'Successfully added link ' + createdLink.device1 + ' - ' + createdLink.device2
  );
  response.redirect('/links');
});
//SHOW LINK ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundLink = await middleware.findByIdOr404(
    Link,
    request.params.id,
    response,
    'Link',
    '/links'
  );
  if (!foundLink) return;
  response.render('links/show', { link: foundLink });
});

//EDIT LINK ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundLink = await middleware.findByIdOr404(
    Link,
    request.params.id,
    response,
    'Link',
    '/links'
  );
  if (!foundLink) return;
  response.render('links/edit', { link: foundLink, types: Link.LINK_TYPES });
});
//UPDATE LINK ROUTE
router.put('/:id', async function (request, response) {
  const fields = Link.normalizeInput(request.body.link || {});
  const invalidSpeed = speedError(fields);
  if (invalidSpeed) {
    request.flash('error', invalidSpeed);
    return response.redirect('/links/' + request.params.id + '/edit');
  }
  fields.lastUpdate = new Date();
  try {
    const updated = await Link.findByIdAndUpdate(request.params.id, fields, {
      runValidators: true,
      new: true,
    });
    if (!updated) {
      request.flash('error', 'Link not found');
      return response.redirect('/links');
    }
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/links/' + request.params.id + '/edit');
  }
  request.flash('success', 'Link updated');
  response.redirect('/links/' + request.params.id);
});

//DESTROY LINK ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/links');
  }
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'link', Link, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/links');
});

module.exports = router;
