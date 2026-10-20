/*
 * cobweb.js — örümcek ağı (cobweb) diyagramı
 *
 * Grafik kütüphanesi kullanmadan Canvas 2D ile çizer:
 *   - y = x doğrusu (kesikli), y = g(x) eğrisi,
 *   - (x_k, x_k) → (x_k, g(x_k)) → (g(x_k), g(x_k)) basamakları.
 * Eksen aralığı iterasyon noktalarına göre otomatik seçilir; renkler
 * CSS değişkenlerinden okunur, böylece açık/koyu temaya uyar.
 */
(function (root) {
  'use strict';

  var EN_FAZLA_BASAMAK = 200; // çok uzun iterasyonlarda çizimi sınırla

  function cssRenk(ad, yedek) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(ad);
    return v && v.trim() ? v.trim() : yedek;
  }

  // 1, 2, 5 × 10^n biçiminde "güzel" ızgara adımı.
  function guzelAdim(aralik, hedefSayi) {
    var ham = aralik / hedefSayi;
    var us = Math.pow(10, Math.floor(Math.log(ham) / Math.LN10));
    var oran = ham / us;
    var adim = oran < 1.5 ? 1 : oran < 3.5 ? 2 : oran < 7.5 ? 5 : 10;
    return adim * us;
  }

  function etiket(v, adim) {
    if (Math.abs(v) < adim * 1e-6) return '0';
    var basamak = Math.max(0, Math.min(8, -Math.floor(Math.log(adim) / Math.LN10 + 1e-9)));
    var a = Math.abs(v);
    if (a >= 1e5 || (a < 1e-3 && a > 0)) return v.toExponential(1).replace('-', '−');
    return v.toFixed(basamak).replace('-', '−');
  }

  /*
   * Gösterilecek basamak sayısını seçer: ıraksayan dizilerde ilk birkaç
   * adım, büyük değerler yüzünden görünmez olmasın diye alan, ilk 4 değerin
   * yayılımının 20 katını aşınca kesilir.
   */
  function gorunurBasamaklar(rows) {
    var gecerli = [];
    for (var i = 0; i < rows.length && gecerli.length < EN_FAZLA_BASAMAK; i++) {
      var r = rows[i];
      if (!isFinite(r.x)) break;
      gecerli.push(r);
    }
    var degerler = [];
    var ilkYayilim = null;
    var sonuc = [];
    for (var j = 0; j < gecerli.length; j++) {
      var row = gecerli[j];
      degerler.push(row.x);
      if (row.gx !== null && isFinite(row.gx)) degerler.push(row.gx);
      var lo = Math.min.apply(null, degerler), hi = Math.max.apply(null, degerler);
      if (j === Math.min(3, gecerli.length - 1)) ilkYayilim = Math.max(hi - lo, 1e-9);
      if (ilkYayilim !== null && j > 3 && (hi - lo) > 20 * ilkYayilim) break;
      sonuc.push(row);
    }
    return { rows: sonuc, truncated: sonuc.length < rows.length };
  }

  function draw(canvas, veri) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var genislik = canvas.clientWidth || 600;
    var yukseklik = canvas.clientHeight || genislik;
    canvas.width = Math.round(genislik * dpr);
    canvas.height = Math.round(yukseklik * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var renk = {
      zemin: cssRenk('--plot-bg', '#fbf7ee'),
      izgara: cssRenk('--plot-grid', '#e3d9c2'),
      eksen: cssRenk('--plot-axis', '#8c8470'),
      kosegen: cssRenk('--plot-diag', '#7a7566'),
      egri: cssRenk('--plot-curve', '#1d3461'),
      ag: cssRenk('--plot-web', '#b0472a'),
      kok: cssRenk('--plot-root', '#2f7d4f'),
      yazi: cssRenk('--ink-soft', '#4a4c57')
    };
    var font = getComputedStyle(document.body).fontFamily;

    ctx.fillStyle = renk.zemin;
    ctx.fillRect(0, 0, genislik, yukseklik);

    var secim = gorunurBasamaklar(veri.rows || []);
    var rows = secim.rows;
    if (!rows.length) return { note: 'Çizilecek geçerli nokta yok.' };

    // ---- Eksen aralığı (x ve y için aynı ölçek → y = x 45° görünür)
    var degerler = [];
    rows.forEach(function (r) {
      degerler.push(r.x);
      if (r.gx !== null && isFinite(r.gx)) degerler.push(r.gx);
    });
    var lo = Math.min.apply(null, degerler);
    var hi = Math.max.apply(null, degerler);
    var yayilim = hi - lo;
    if (!(yayilim > 1e-12)) yayilim = Math.max(1, Math.abs(lo)) * 0.5;
    var pay = yayilim * 0.15;
    lo -= pay; hi += pay;
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }

    var sol = 48, sag = 14, ust = 14, alt = 36;
    var cw = genislik - sol - sag, ch = yukseklik - ust - alt;
    function px(x) { return sol + (x - lo) / (hi - lo) * cw; }
    function py(y) { return ust + ch - (y - lo) / (hi - lo) * ch; }

    // ---- Izgara ve eksen etiketleri
    var adim = guzelAdim(hi - lo, 6);
    ctx.lineWidth = 1;
    ctx.font = '12px ' + font;
    ctx.fillStyle = renk.yazi;
    ctx.strokeStyle = renk.izgara;
    var t0 = Math.ceil(lo / adim) * adim;
    for (var t = t0; t <= hi + adim * 1e-9; t += adim) {
      var X = Math.round(px(t)) + 0.5, Y = Math.round(py(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(X, ust); ctx.lineTo(X, ust + ch); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sol, Y); ctx.lineTo(sol + cw, Y); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(etiket(t, adim), X, ust + ch + 6);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(etiket(t, adim), sol - 6, Y);
    }
    // Sıfır eksenleri (görünür aralıktaysa)
    ctx.strokeStyle = renk.eksen;
    ctx.lineWidth = 1.2;
    if (lo < 0 && hi > 0) {
      ctx.beginPath(); ctx.moveTo(px(0), ust); ctx.lineTo(px(0), ust + ch); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sol, py(0)); ctx.lineTo(sol + cw, py(0)); ctx.stroke();
    }
    ctx.strokeRect(sol + 0.5, ust + 0.5, cw - 1, ch - 1);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.font = 'italic 13px ' + font;
    ctx.fillText('x', sol + cw - 4, ust + ch - 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('y', sol + 5, ust + 4);

    ctx.save();
    ctx.beginPath();
    ctx.rect(sol, ust, cw, ch);
    ctx.clip();

    // ---- y = x
    ctx.strokeStyle = renk.kosegen;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(px(lo), py(lo)); ctx.lineTo(px(hi), py(hi)); ctx.stroke();
    ctx.setLineDash([]);

    // ---- y = g(x): tanımsız/karmaşık noktalarda ve sıçramalarda çizgi kırılır
    if (typeof veri.g === 'function') {
      ctx.strokeStyle = renk.egri;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      var acik = false;
      var n = Math.max(200, Math.round(cw * 1.5));
      var sinir = (hi - lo) * 50;
      for (var i = 0; i <= n; i++) {
        var x = lo + (hi - lo) * i / n;
        var r = veri.g(x);
        if (r.kind !== 'real' || Math.abs(r.value - (lo + hi) / 2) > sinir) { acik = false; continue; }
        if (!acik) { ctx.moveTo(px(x), py(r.value)); acik = true; }
        else ctx.lineTo(px(x), py(r.value));
      }
      ctx.stroke();
    }

    // ---- Basamaklar
    ctx.strokeStyle = renk.ag;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    var ilk = rows[0];
    ctx.moveTo(px(ilk.x), py(lo));
    ctx.lineTo(px(ilk.x), py(ilk.x));
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k];
      if (row.gx === null || !isFinite(row.gx)) break;
      ctx.lineTo(px(row.x), py(row.gx));      // dikey: eğriye
      ctx.lineTo(px(row.gx), py(row.gx));     // yatay: y = x doğrusuna
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // x0 başlangıç noktası
    ctx.fillStyle = renk.ag;
    ctx.beginPath(); ctx.arc(px(ilk.x), py(ilk.x), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = renk.ag;
    ctx.font = 'italic 13px ' + font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('x₀', px(ilk.x), ust + ch - 3);

    // Son değer / kök
    var son = rows[rows.length - 1];
    if (son && isFinite(son.x)) {
      ctx.strokeStyle = renk.kok;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(px(son.x), py(son.x), 6, 0, Math.PI * 2); ctx.stroke();
    }

    var not = '';
    if (secim.truncated) {
      not = 'Değerler hızla büyüdüğü için yalnızca ilk ' + rows.length + ' adım gösteriliyor (toplam ' +
        veri.rows.length + ' satır).';
    } else if (veri.converged) {
      not = 'Basamaklar sabit noktaya, yani y = x ile y = g(x) eğrisinin kesişimine doğru ilerliyor.';
    }
    return { note: not, shownSteps: rows.length, range: [lo, hi] };
  }

  root.Cobweb = { draw: draw };
})(typeof self !== 'undefined' ? self : this);
