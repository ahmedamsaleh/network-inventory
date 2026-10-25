/* List pages: the checked row of #eventsTable drives the toolbar forms
 * (views/partials/toolbar.ejs): every form with data-action-template gets its
 * action filled in ("/pops/{id}/edit"), buttons with data-needs-selection are
 * enabled, forms with data-confirm ask before submitting. */
var $j = jQuery.noConflict();
$j(document).ready(function () {
  $j('#input-id').fileinput({
    maxFileCount: 10,
    allowedFileTypes: ['text'],
    allowedFileExtensions: ['csv'],
  });

  var $table = $j('#eventsTable');

  function applySelection(row) {
    $j('[data-action-template]').each(function () {
      var template = $j(this).attr('data-action-template');
      $j(this).attr('action', row ? template.replace('{id}', row._id) : template.replace('{id}', '-1'));
    });
    $j('[data-needs-selection]').prop('disabled', !row);
  }

  $table.on('check.bs.table', function (e, row) {
    applySelection(row);
  });
  $table.on('uncheck.bs.table uncheck-all.bs.table', function () {
    applySelection(null);
  });
  $table.on('load-success.bs.table', function () {
    applySelection(null);
  });

  $j('form[data-confirm]').on('submit', function () {
    return window.confirm($j(this).attr('data-confirm'));
  });
});
