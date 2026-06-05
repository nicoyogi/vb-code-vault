// AUTO-GENERATED — do not edit by hand.
// Source:
//   • data/Wackler National Rate.xlsx (sheet "Basis") → national rate matrix (TIERS/ZONES/BASIS)
// Wackler NATIONAL (domestic German) freight rate card: per German rate-zone EUR rate by
// chargeable-weight tier. The nine columns of the source sheet (headed 1‑9) are the German
// rate zones DE1‑DE9 — the exact zone codes the international card's ZONE_DIVISION['DE'] postal
// map already resolves to (those DE cells carry no rate in the international BASIS). This card
// fills them in, so a domestic German shipment now has a real published rate.
// Loaded as a standalone asset (see anmerkung.html) so the rate matrix lives OUTSIDE
// assets/anmerkung.js; the Anmerkung engine consumes it through the global
// WACKLER_NATIONAL_RATECARD (graceful no-op when absent) to enrich the "Wackler rechnet" note.
(function (root) {
  'use strict';

  // Chargeable-weight tier breakpoints (kg). Each value is the INCLUSIVE upper bound of a
  // rate-card bucket. Unlike the international card (one open ">10000" ceiling), the national
  // sheet publishes explicit heavy tiers up to 24000 kg; rates flatline from 8000 kg upward.
  var TIERS = [50,100,150,200,250,300,350,400,450,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2200,2400,2600,2800,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,8500,9000,9500,10000,12500,15000,17500,20000,24000];

  // German rate zones. DE1‑DE9 line up 1:1 with the international card's ZONE_DIVISION['DE']
  // (which maps a German postal prefix → DE1…DE9), so a domestic PLZ resolves to a column here.
  var ZONES = ['DE1','DE2','DE3','DE4','DE5','DE6','DE7','DE8','DE9'];

  // EUR rate matrix, keyed by zone -> array of rates parallel to TIERS.
  var BASIS = {
    'DE1': [28.86,28.86,29.5,32.07,33.14,34.59,39.56,44.19,48.17,49.76,57.46,64.34,71.05,77.94,80.71,83.71,88.02,92.14,96.13,99.71,104.57,109.12,113.24,114.78,116.45,152.35,156.55,160.77,162.9,164.99,177.5,221.75,230.6,236.5,242.4,251.25,266,282.23,296.24,310.25,310.25,310.25,310.25,310.25,310.25,310.25,310.25,310.25,310.25],
    'DE2': [28.99,28.99,29.5,32.46,36.11,39.51,44.31,52.17,55.2,58.1,67.22,73.92,83.52,91.17,95.33,99.42,102.58,108.66,112.97,119.6,136.83,147.57,153.07,155.28,157.35,194.8,199.45,204.1,206.41,208.73,231.88,292.44,319,327.5,336,348.75,370,412.5,433.75,433.75,433.75,433.75,433.75,433.75,433.75,433.75,433.75,433.75,433.75],
    'DE3': [29.5,32.07,32.07,35.8,44.83,46.88,53.49,59.81,65.07,67.42,77.63,86.8,96.01,105.36,109.04,113.12,119.02,124.56,130,134.76,155.49,162.36,168.49,170.78,173.11,211.07,215.71,220.29,222.69,227.29,295,374.5,390.4,401,411.6,419.55,432.8,507,533.5,549.4,549.4,549.4,549.4,549.4,549.4,549.4,549.4,549.4,549.4],
    'DE4': [29.5,32.07,33.44,42.04,52.84,55.03,62.8,70.37,76.53,79.23,91.37,102.16,112.91,124,128.45,133.11,140.1,146.66,152.97,158.76,183.25,191.19,198.26,201.08,203.76,243.53,250.52,257.47,259.78,262.12,345,439.5,458.4,471,483.6,502.5,508.8,568.65,598.58,647.4,647.4,647.4,647.4,647.4,647.4,647.4,647.4,647.4,647.4],
    'DE5': [29.5,32.07,36.58,45.89,57.77,60.2,68.83,76.95,83.84,86.8,99.99,111.8,123.45,135.65,140.55,145.64,153.33,160.42,167.4,173.73,200.47,209.28,217.06,220.12,223.23,262.12,271.4,278.37,283.01,285.32,387.5,471.51,491.89,505.48,519.06,566.25,573.4,673.5,709.25,745,745,745,745,745,745,745,745,745,745],
    'DE6': [32.07,32.07,38.64,49.36,61.93,64.58,74.03,82.84,90.31,93.45,107.55,120.39,132.99,146.08,151.33,156.84,165.1,172.74,180.28,187.06,215.87,225.27,233.73,236.99,240.18,280.7,289.98,296.95,301.56,303.88,420,537,560.4,565.08,580.37,603.3,654,696.9,771,794.4,794.4,794.4,794.4,794.4,794.4,794.4,794.4,794.4,794.4],
    'DE7': [32.07,32.07,38.66,50.09,62.16,65.9,77.34,86.36,94.25,97.59,112.26,125.79,138.87,152.53,157.87,163.75,172.3,180.41,188.15,195.15,225.27,235.16,243.98,247.27,250.7,292.3,301.56,308.53,313.18,315.51,467.5,598.75,625,630.25,647.4,673.13,716,817.5,861.25,887.5,905,905,905,905,905,905,905,905,905],
    'DE8': [32.07,32.07,41.03,52.09,65.86,68.83,78.74,88.14,96,99.42,114.44,128.09,141.42,155.44,160.94,166.87,175.64,183.73,191.72,198.94,229.67,239.71,248.62,252.05,255.45,296.95,306.21,315.51,318.79,321.61,502.5,644.25,659.75,678.27,696.79,724.58,786,880.5,927.75,956.1,956.1,956.1,956.1,956.1,956.1,956.1,956.1,956.1,956.1],
    'DE9': [32.07,32.07,41.29,52.54,66.33,69.17,79.35,88.71,96.57,100.1,115.35,128.99,142.41,156.43,162.07,168.08,176.81,185.07,193.04,200.39,231.27,241.28,250.31,253.75,257.19,299.23,308.53,317.82,322.47,327.11,535.88,687.64,717.99,738.23,758.46,828.75,882,988.5,1041.75,1095,1095,1095,1095,1095,1095,1095,1095,1095,1095],
  };

  // First tier index whose breakpoint is >= kg. <=0 -> -1 (no rate); above the top tier -> last index.
  function getTierIdx(kg) {
    if (!(kg > 0)) return -1;
    for (var i = 0; i < TIERS.length; i++) if (kg <= TIERS[i]) return i;
    return TIERS.length - 1;
  }

  // Tier breakpoint (kg) a weight bills against: <=0 -> 0, else the first breakpoint >= kg,
  // else the top (24000) breakpoint for anything heavier than the published table.
  function getTier(kg) {
    if (!(kg > 0)) return 0;
    for (var i = 0; i < TIERS.length; i++) if (kg <= TIERS[i]) return TIERS[i];
    return TIERS[TIERS.length - 1];
  }

  // Human label for a tier breakpoint. The national table has no open ceiling, so every tier
  // renders as its plain number.
  function tierLabel(tierKg) {
    return String(tierKg);
  }

  function hasZone(zone) {
    return !!zone && BASIS.hasOwnProperty(zone);
  }

  // Published EUR rate for a (weight, zone). Returns 0 when the zone is unknown, the weight is
  // non-positive, or the rate-card cell is blank/zero.
  function rate(kg, zone) {
    if (!hasZone(zone)) return 0;
    var idx = getTierIdx(kg);
    if (idx < 0) return 0;
    var v = BASIS[zone][idx];
    return typeof v === 'number' && v > 0 ? v : 0;
  }

  // Normalise a German zone token to a DEn code:
  //   'DE7' / 'de 7' / 'DE-7' / '7' -> 'DE7'   (returns null for anything outside 1‑9)
  function normalizeZone(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return null;
    if (BASIS.hasOwnProperty(s)) return s;          // already DE1..DE9
    var m = s.match(/^(?:DE)?([1-9])$/);            // bare "7" or "DE7"
    return m ? 'DE' + m[1] : null;
  }

  // Resolve a domestic destination to a German rate zone (DE1..DE9).
  //   resolveZone('DE7')            -> 'DE7'   (explicit zone token)
  //   resolveZone('DE', '70173')    -> 'DE2'   (via the international card's German postal map)
  //   resolveZone('DE')             -> null    (ambiguous: needs a postal code)
  // The postal resolution borrows the international card's ZONE_DIVISION['DE'] so the big German
  // postal-prefix map is not duplicated here; it degrades to null when that card isn't loaded.
  function resolveZone(raw, plz) {
    var direct = normalizeZone(raw);
    if (direct) return direct;
    var intl = root.WACKLER_RATECARD;
    if (intl && typeof intl.resolveZoneByPostal === 'function' && plz != null && plz !== '') {
      var p = String(plz);
      if (!/[A-Za-z]/.test(p)) {                    // domestic German PLZ is purely numeric
        var z = intl.resolveZoneByPostal('DE', p);
        if (z && BASIS.hasOwnProperty(z)) return z;
      }
    }
    return null;
  }

  // German-style currency rendering, e.g. 29.5 -> "29,50 €".
  function fmtEUR(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return v.toFixed(2).replace('.', ',') + ' €';
  }

  var RC = {
    source: 'data/Wackler National Rate.xlsx (Basis)',
    tiers: TIERS,
    zones: ZONES,
    basis: BASIS,
    getTierIdx: getTierIdx,
    getTier: getTier,
    tierLabel: tierLabel,
    hasZone: hasZone,
    rate: rate,
    normalizeZone: normalizeZone,
    resolveZone: resolveZone,
    fmtEUR: fmtEUR,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RC;
  root.WACKLER_NATIONAL_RATECARD = RC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
