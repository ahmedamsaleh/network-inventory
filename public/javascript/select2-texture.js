/* select2 pickers of the device forms (POP / sector / county), fed by the
 * pagination endpoints ({ total, rows }; rows carry id + name). The lists are
 * only fetched on pages that have the pickers. */
var $j = jQuery.noConflict();
$j(document).ready(function () {
  $j.fn.select2.defaults.set('theme', 'bootstrap');

  function picker(selector, url) {
    var $elements = $j(selector);
    if (!$elements.length) return;
    $j.getJSON(url).done(function (data) {
      var items = $j.map(data.rows || [], function (row) {
        return { id: row._id || row.id, text: row.name || row.text };
      });
      $elements.each(function () {
        var $element = $j(this);
        var current = $element.val();
        var currentText = $element.attr('data-init-text');
        // keep the stored value selectable even when it is not in the list any more
        if (current && !items.some(function (item) { return item.id === current; })) {
          items.unshift({ id: current, text: currentText || current });
        }
        $element.select2({
          placeholder: 'choose...',
          allowClear: true,
          selectOnClose: true,
          data: items,
          theme: 'bootstrap',
          width: null,
          minimumInputLength: 0,
        });
        if (current) $element.val(current).trigger('change');
      });
    });
  }

  picker('#device-pop-name, #new-device-pop-name', '/pops/pagination?limit=500&sort=name');
  picker('#device-sector-name, #new-device-sector-name', '/sectors/pagination?limit=500&sort=name');
  picker('#device-county-name, #new-device-county-name', '/counties/pagination?limit=500&sort=name');

  $j('#device-type').select2({ placeholder: 'Search', theme: 'bootstrap', width: null });

  // interface edit form: the international details only make sense for international links
  function toggleInternational() {
    var $type = $j('#interface-linkType');
    if (!$type.length) return;
    var international = String($type.val() || '').toLowerCase() === 'international';
    $j('.app-international').toggle(international);
  }
  $j('#interface-linkType').on('change', toggleInternational);
  toggleInternational();
});
