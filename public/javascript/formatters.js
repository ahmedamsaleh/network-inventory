/* bootstrap-table cell formatters shared by every list (views/partials/data-table.ejs).
 * bootstrap-table looks formatters up by name on window, hence the globals. */
(function (window) {
  'use strict';

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function linkTo(base, idField) {
    return function (value, row) {
      var id = row[idField || '_id'];
      if (!id) return escapeHtml(value);
      return (
        '<a href="' + base + '/' + encodeURIComponent(id) + '">' + escapeHtml(value) + '</a>'
      );
    };
  }

  function blank(value) {
    return value === undefined || value === null || value === '';
  }

  window.escapeHtml = escapeHtml;
  window.dateFormatter = function (value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d.getTime())
      ? ''
      : d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  };
  window.dateTimeFormatter = function (value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d.getTime())
      ? ''
      : window.dateFormatter(value) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  };
  window.booleanFormatter = function (value) {
    if (blank(value)) return '';
    return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes'
      ? '<span class="label label-success">yes</span>'
      : '<span class="label label-default">no</span>';
  };
  window.statusFormatter = function (value) {
    if (blank(value)) return '';
    var v = String(value).toLowerCase();
    var cls = v === 'up' || v === 'ok' ? 'label-success' : v === 'down' ? 'label-danger' : 'label-default';
    return '<span class="label ' + cls + '">' + escapeHtml(value) + '</span>';
  };
  window.numberFormatter = function (value) {
    if (blank(value)) return '';
    var n = Number(value);
    return isNaN(n) ? escapeHtml(value) : n.toLocaleString('en-US');
  };
  window.unknownFormatter = function (value) {
    if (blank(value)) return '<span class="text-muted">&mdash;</span>';
    if (value === 'Unknown' || value === 'Unkown') return '<span class="text-muted">' + escapeHtml(value) + '</span>';
    return escapeHtml(value);
  };
  window.jsonFormatter = function (value) {
    if (blank(value)) return '';
    var text = typeof value === 'string' ? value : JSON.stringify(value);
    return '<code class="app-mono">' + escapeHtml(text.length > 80 ? text.slice(0, 80) + '…' : text) + '</code>';
  };
  window.deviceLinkFormatter = linkTo('/devices');
  window.interfaceLinkFormatter = linkTo('/interfaces');
  window.popLinkFormatter = linkTo('/pops');
  window.linkLinkFormatter = linkTo('/links');
  window.cabinetLinkFormatter = linkTo('/cabinets');
  window.devicemodelLinkFormatter = linkTo('/devicemodels');
  window.btmsaninfoLinkFormatter = linkTo('/btmsaninfos');
  window.sectorLinkFormatter = linkTo('/sectors');
  window.countyLinkFormatter = linkTo('/counties');
  window.userLinkFormatter = linkTo('/users');
  window.validateduserLinkFormatter = linkTo('/validatedusers');
  window.auditLinkFormatter = linkTo('/audit');
  /* a hostname cell pointing at the device page (GET /devices/hostname/:hostname) */
  window.hostnameLinkFormatter = function (value) {
    if (blank(value)) return '';
    return '<a href="/devices/hostname/' + encodeURIComponent(value) + '">' + escapeHtml(value) + '</a>';
  };
  window.auditTargetFormatter = function (value, row) {
    if (row.targetType === 'device' && row.targetId) {
      return '<a href="/devices/' + encodeURIComponent(row.targetId) + '">' + escapeHtml(value) + '</a>';
    }
    return escapeHtml(value);
  };
})(window);
