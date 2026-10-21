/*
 * app.js — arayüz katmanı
 *
 * Hesap yapmaz; girdileri toplar, FixedPoint.solve() (solver.js) çağırır ve
 * dönen sonuç nesnesini ekrana çizer. Tema, örnekler, kopyalama/CSV burada.
 */
(function () {
  'use strict';

  var FP = window.FixedPoint;
  var $ = function (id) { return document.getElementById(id); };

  // ---- Hazır örnekler ----------------------------------------------------
  var ORNEKLER = [
    { ad: 'g(x) = cos(x)', etiket: 'yakınsar', p: { mode: 'g', expr: 'cos(x)', startMode: 'x0', x0: '0.5', tol: '1e-6', nmax: '100' } },
    { ad: 'g(x) = (x+2)^(1/3)', etiket: 'x³−x−2=0', p: { mode: 'g', expr: '(x+2)^(1/3)', startMode: 'x0', x0: '1', tol: '1e-6', nmax: '100' } },
    { ad: 'g(x) = exp(-x)', etiket: 'aralık [0.3, 1]', p: { mode: 'g', expr: 'exp(-x)', startMode: 'interval', a: '0.3', b: '1', tol: '1e-6', nmax: '100' } },
    { ad: 'g(x) = sqrt(x+1)', etiket: 'altın oran', p: { mode: 'g', expr: 'sqrt(x+1)', startMode: 'x0', x0: '1', tol: '1e-6', nmax: '100' } },
    { ad: 'f(x) = x - cos(x)', etiket: 'f modu, yakınsar', p: { mode: 'f', expr: 'x - cos(x)', startMode: 'x0', x0: '0.5', tol: '1e-6', nmax: '100' } },
    { ad: 'f(x) = x^3 - x - 2', etiket: 'f modu, yakınsamaz', kotu: true, p: { mode: 'f', expr: 'x^3 - x - 2', startMode: 'x0', x0: '1.5', tol: '1e-6', nmax: '100' } },
    { ad: 'g(x) = x^2 + 1', etiket: 'ıraksar', kotu: true, p: { mode: 'g', expr: 'x^2 + 1', startMode: 'x0', x0: '0', tol: '1e-6', nmax: '100' } },
    { ad: 'g(x) = sqrt(x-5)', etiket: 'gerçek değil', kotu: true, p: { mode: 'g', expr: 'sqrt(x-5)', startMode: 'x0', x0: '1', tol: '1e-6', nmax: '100' } }
  ];

  var sonSonuc = null;   // son hesaplanan sonuç (kopyalama/CSV/cobweb için)
  var sonG = null;       // son sonuç için g(x) hesaplayıcısı (cobweb eğrisi)

  // ---- KaTeX yardımcıları ------------------------------------------------
  function tex(src, display) {
    if (!window.katex) return escapeHtml(src);
    try {
      return window.katex.renderToString(src, { displayMode: !!display, throwOnError: false, strict: 'ignore' });
    } catch (e) {
      return escapeHtml(src);
    }
  }

  function renderStaticTex(root) {
    var els = (root || document).querySelectorAll('.tex[data-tex]');
    for (var i = 0; i < els.length; i++) {
      els[i].innerHTML = tex(els[i].getAttribute('data-tex'), false);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Sayıyı TeX'e uygun yazar (1.2e-7 → 1.2 \times 10^{-7}).
  function numTex(v) {
    var s = FP.formatNumber(v);
    var m = /^(-?[\d.]+)e([+-]\d+)$/.exec(s);
    if (m) return m[1] + ' \\times 10^{' + Number(m[2]) + '}';
    return s.replace('∞', '\\infty').replace('−', '-');
  }

  // ---- Tema ----------------------------------------------------------------
  function mevcutTema() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function temaDugmesiniGuncelle() {
    var koyu = mevcutTema() === 'dark';
    $('tema-dugmesi').textContent = koyu ? '☀ Açık tema' : '☾ Koyu tema';
    $('tema-dugmesi').setAttribute('aria-pressed', koyu ? 'true' : 'false');
  }

  function temaAyarla(t, kaydet) {
    document.documentElement.setAttribute('data-theme', t);
    if (kaydet) {
      try { window.localStorage.setItem('sni-tema', t); } catch (e) { /* depolama kapalı olabilir */ }
    }
    temaDugmesiniGuncelle();
    cobwebCiz();
  }

  function temaKurulumu() {
    temaDugmesiniGuncelle();
    $('tema-dugmesi').addEventListener('click', function () {
      temaAyarla(mevcutTema() === 'dark' ? 'light' : 'dark', true);
    });
    // Kullanıcı seçim yapmadıysa sistem teması değişimini izle.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var dinle = function (e) {
        var kayitli = null;
        try { kayitli = window.localStorage.getItem('sni-tema'); } catch (err) { kayitli = null; }
        if (kayitli !== 'light' && kayitli !== 'dark') temaAyarla(e.matches ? 'dark' : 'light', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', dinle);
      else if (mq.addListener) mq.addListener(dinle);
    }
  }

  // ---- Form ----------------------------------------------------------------
  function secili(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function seciliYap(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function parametreler() {
    return {
      mode: secili('mode'),
      expr: $('expr').value,
      startMode: secili('startMode'),
      x0: $('x0').value,
      a: $('a').value,
      b: $('b').value,
      tol: $('tol').value,
      nmax: $('nmax').value
    };
  }

  function modGorunumu() {
    var f = secili('mode') === 'f';
    $('expr-etiket').textContent = f ? 'f(x) =' : 'g(x) =';
    $('expr').placeholder = f ? 'ör. x - cos(x)' : 'ör. cos(x)';
    $('mod-aciklama').innerHTML = f
      ? 'Bu modda ' + tex('g(x) = x - f(x)') + ' kullanılır. Bu seçim çoğu f için <strong>yakınsamaz</strong>; ' +
        'yakınsamazsa denklemi kendiniz ' + tex('x = g(x)') + ' biçimine dönüştürün.'
      : 'Sabit nokta: ' + tex('x^* = g(x^*)') + '. Yakınsama için kök civarında ' + tex("|g'(x)| < 1") + ' olmalıdır.';
    var aralik = secili('startMode') === 'interval';
    $('x0-alani').hidden = aralik;
    $('aralik-alani').hidden = !aralik;
    onizlemeGuncelle();
  }

  function onizlemeGuncelle() {
    var kutu = $('onizleme');
    var mode = secili('mode');
    var metin = $('expr').value;
    kutu.className = 'preview';
    if (!metin.trim()) {
      kutu.classList.add('is-empty');
      kutu.textContent = 'İfade yazdıkça burada matematiksel gösterimi görünür.';
      return;
    }
    var fn = FP.buildFunction(metin, mode, window.math);
    if (!fn.ok) {
      kutu.classList.add('is-error');
      kutu.textContent = fn.error.message;
      return;
    }
    var s;
    if (mode === 'f') {
      s = tex('f(x) = ' + fn.inputTex) + ' &nbsp;⇒&nbsp; ' +
          tex('g(x) = ' + fn.gTex + (fn.simplifiedTex ? ' = ' + fn.simplifiedTex : ''));
    } else {
      s = tex('g(x) = ' + fn.gTex);
    }
    kutu.innerHTML = s;
  }

  function ornekleriKur() {
    var liste = $('ornekler');
    ORNEKLER.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn example-btn';
      b.innerHTML = '<span>' + escapeHtml(o.ad) + '</span><span class="ex-tag' + (o.kotu ? ' tag-bad' : '') + '">' +
        escapeHtml(o.etiket) + '</span>';
      b.addEventListener('click', function () { ornekYukle(o.p); });
      liste.appendChild(b);
    });
  }

  function ornekYukle(p) {
    seciliYap('mode', p.mode);
    seciliYap('startMode', p.startMode);
    $('expr').value = p.expr;
    if (p.x0 !== undefined) $('x0').value = p.x0;
    if (p.a !== undefined) $('a').value = p.a;
    if (p.b !== undefined) $('b').value = p.b;
    $('tol').value = p.tol;
    $('nmax').value = p.nmax;
    modGorunumu();
    hesapla();
  }

  // Hata kodlarını ilgili giriş kutusuna bağlar (kırmızı çerçeve).
  var ALAN_KODLARI = {
    'ifade-bos': 'expr', 'sozdizimi': 'expr', 'bilinmeyen-fonksiyon': 'expr', 'bilinmeyen-degisken': 'expr',
    'x0': 'x0', 'a': 'a', 'b': 'b', 'aralik': ['a', 'b'], 'tol': 'tol', 'nmax': 'nmax'
  };

  function alanHatalariniIsaretle(errors) {
    ['expr', 'x0', 'a', 'b', 'tol', 'nmax'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    errors.forEach(function (e) {
      var alan = ALAN_KODLARI[e.code];
      if (!alan) return;
      [].concat(alan).forEach(function (id) { $(id).setAttribute('aria-invalid', 'true'); });
    });
  }

  // ---- Hesapla ------------------------------------------------------------
  function hesapla() {
    var sonuc;
    try {
      if (!FP) throw new Error('solver.js yüklenemedi.');
      sonuc = FP.solve(parametreler(), window.math);
    } catch (e) {
      sonuc = { ok: false, errors: [{ code: 'beklenmeyen', message: 'Beklenmeyen bir hata oluştu: ' + e.message }], warnings: [], notes: [], rows: [] };
    }
    sonSonuc = sonuc;
    sonG = null;
    if (sonuc.ok) {
      var fn = FP.buildFunction(parametreler().expr, sonuc.mode, window.math);
      if (fn.ok) sonG = FP.makeEvaluator(fn.compiled);
    }

    alanHatalariniIsaretle(sonuc.errors || []);
    $('bos-durum').hidden = true;
    $('sonuc-alani').hidden = false;

    yontemCiz(sonuc);
    mesajlariCiz(sonuc);
    var tabloVar = sonuc.ok && sonuc.rows.length > 0;
    $('tablo-bolumu').hidden = !tabloVar;
    $('ozet').hidden = !sonuc.ok;
    $('cobweb-bolumu').hidden = !tabloVar;
    if (tabloVar) tabloCiz(sonuc);
    if (sonuc.ok) ozetCiz(sonuc);
    $('kopya-durum').textContent = '';
    if (tabloVar) cobwebCiz();

    // Hata veya uyarı varsa doğrudan mesajlara, dar ekranda ise sonuçlara kaydır.
    var mesajVar = (sonuc.errors && sonuc.errors.length) || (sonuc.warnings && sonuc.warnings.length);
    var hedef = mesajVar ? $('mesajlar') : (window.innerWidth <= 880 ? $('sonuc-alani') : null);
    if (hedef && hedef.scrollIntoView) hedef.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Girdileri ilk açılıştaki hâline döndürür, sonuçları siler.
  function temizle() {
    // Seçili denklem biçimi ve başlangıç türü korunur; yalnızca kutular sıfırlanır.
    var mod = secili('mode');
    var baslangic = secili('startMode');
    $('form').reset();
    seciliYap('mode', mod);
    seciliYap('startMode', baslangic);
    $('expr').value = '';
    sonSonuc = null;
    sonG = null;
    alanHatalariniIsaretle([]);
    $('mesajlar').innerHTML = '';
    $('tablo').querySelector('tbody').innerHTML = '';
    $('ozet-icerik').innerHTML = '';
    $('yontem-icerik').innerHTML = '';
    $('kopya-durum').textContent = '';
    $('cobweb-not').textContent = '';
    $('sonuc-alani').hidden = true;
    $('bos-durum').hidden = false;
    modGorunumu();
    // Hiçbir alana odaklanma (imleç ve sayfa sola/aşağı atlamasın).
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function yontemCiz(r) {
    var kutu = $('yontem-icerik');
    if (!r.ok) {
      $('yontem').hidden = true;
      kutu.innerHTML = '';
      return;
    }
    $('yontem').hidden = false;
    var h = '';
    if (r.mode === 'f') {
      h += '<div class="formula-block">' + tex('f(x) = ' + r.func.inputTex + ' = 0', true) + '</div>';
      h += '<div class="formula-block">' + tex('g(x) = x - f(x) = ' + r.func.gTex +
        (r.func.simplifiedTex ? ' = ' + r.func.simplifiedTex : ''), true) + '</div>';
    } else {
      h += '<div class="formula-block">' + tex('x = g(x), \\qquad g(x) = ' + r.func.gTex, true) + '</div>';
    }
    if (r.derivative && r.derivative.tex) {
      h += '<div class="formula-block">' + tex("g'(x) = " + r.derivative.tex, true) + '</div>';
    } else {
      h += '<p class="hint">' + tex("g'(x)") + ' sembolik olarak alınamadı; merkezi farkla yaklaşık hesaplanıyor: ' +
        tex("g'(x) \\approx \\dfrac{g(x+h) - g(x-h)}{2h}") + '</p>';
    }
    h += '<div class="formula-block">' + tex('x_{k+1} = g(x_k), \\quad k = 0, 1, 2, \\dots \\qquad ' +
      '\\text{dur: } |x_{k+1} - x_k| < \\varepsilon', true) + '</div>';

    h += '<ul class="param-list">';
    if (r.startMode === 'interval') {
      h += '<li>' + tex('[a, b] = [' + numTex(r.interval.a) + ',\\ ' + numTex(r.interval.b) + ']') + '</li>';
      h += '<li>' + tex('x_0 = \\tfrac{a+b}{2} = ' + numTex(r.x0)) + '</li>';
      if (r.interval.maxAbsDg !== null) {
        h += '<li>' + tex("\\max_{[a,b]} |g'(x)| \\approx " + numTex(r.interval.maxAbsDg)) + '</li>';
      }
      if (r.interval.gMin !== null) {
        h += '<li>' + tex('g([a,b]) \\approx [' + numTex(r.interval.gMin) + ',\\ ' + numTex(r.interval.gMax) + ']') + '</li>';
      }
    } else {
      h += '<li>' + tex('x_0 = ' + numTex(r.x0)) + '</li>';
    }
    h += '<li>' + tex('\\varepsilon = ' + numTex(r.tol)) + '</li>';
    h += '<li>' + tex('N_{\\max} = ' + r.nmax) + '</li>';
    h += '</ul>';
    kutu.innerHTML = h;
  }

  function mesajlariCiz(r) {
    var kutu = $('mesajlar');
    var h = '';
    function blok(sinif, baslik, liste) {
      if (!liste || !liste.length) return '';
      var s = '<div class="alert ' + sinif + '" role="' + (sinif === 'alert-error' ? 'alert' : 'status') + '"><strong>' + baslik + '</strong>';
      if (liste.length === 1) s += '<div>' + escapeHtml(liste[0].message) + '</div>';
      else s += '<ul>' + liste.map(function (m) { return '<li>' + escapeHtml(m.message) + '</li>'; }).join('') + '</ul>';
      return s + '</div>';
    }
    if (!r.ok) {
      h += blok('alert-error', 'Girdi hatası — hesap yapılmadı', r.errors);
    } else {
      if (r.converged) {
        h += '<div class="alert alert-ok" role="status"><strong>Yakınsadı</strong>' +
          '<div>' + r.iterations + ' iterasyonda tolerans sağlandı: ' +
          tex('|x_{' + r.iterations + '} - x_{' + (r.iterations - 1) + '}| = ' + numTex(r.lastError) + ' < \\varepsilon') + '</div></div>';
      }
      h += blok('alert-error', 'Hata', r.errors);
      h += blok('alert-warn', 'Uyarı', r.warnings);
      h += blok('alert-note', 'Not', r.notes);
    }
    kutu.innerHTML = h;
  }

  function hucre(v) { return escapeHtml(FP.formatNumber(v)); }

  function tabloCiz(r) {
    var tb = $('tablo').querySelector('tbody');
    var parcalar = [];
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var son = i === r.rows.length - 1;
      var gHucre;
      if (row.gx !== null) gHucre = '<td>' + hucre(row.gx) + '</td>';
      else if (row.gKind === 'complex') gHucre = '<td class="cell-bad">gerçek değil</td>';
      else if (row.gKind === 'skip') gHucre = '<td>—</td>';
      else gHucre = '<td class="cell-bad">tanımsız</td>';
      parcalar.push(
        '<tr' + (son ? ' class="final-row"' : '') + '>' +
        '<td>' + row.k + '</td>' +
        '<td>' + hucre(row.x) + '</td>' +
        gHucre +
        '<td>' + (row.error === null ? '—' : hucre(row.error)) + '</td>' +
        '<td' + (row.dgTooLarge ? ' class="cell-warn" title="|g′(x_k)| ≥ 1"' : '') + '>' +
          (row.absDg === null ? '—' : hucre(row.absDg)) + '</td>' +
        '</tr>'
      );
    }
    tb.innerHTML = parcalar.join('');
  }

  function ozetCiz(r) {
    var kutu = $('ozet-icerik');
    var bolum = $('ozet');
    bolum.classList.remove('is-fail', 'is-warn');
    var rozetSinif = 'reason-ok';
    if (r.stopReason === 'nmax') { rozetSinif = 'reason-warn'; bolum.classList.add('is-warn'); }
    else if (!r.converged) { rozetSinif = 'reason-bad'; bolum.classList.add('is-fail'); }

    var h = '';
    if (r.root !== null && r.converged) {
      h += '<div class="summary-root">' + tex('x^* \\approx x_{' + r.iterations + '} = ' + numTex(r.root), false) + '</div>';
    } else if (r.root !== null) {
      h += '<div class="summary-root">Son değer: ' + tex('x_{' + r.iterations + '} = ' + numTex(r.root), false) +
        ' <span class="hint">(kök değildir; yakınsama sağlanmadı)</span></div>';
    }
    h += '<dl class="summary-grid">';
    h += '<div><dt>Toplam adım sayısı</dt><dd>' + r.iterations + '</dd></div>';
    h += '<div><dt>' + (r.converged ? 'Bulunan kök' : 'Son değer') + '</dt><dd>' + hucre(r.root) + '</dd></div>';
    h += '<div><dt>Son hata</dt><dd>' + (r.lastError === null ? '—' : hucre(r.lastError)) + '</dd></div>';
    if (r.residual !== null) h += '<div><dt class="dt-formula">|g(x*) − x*|</dt><dd>' + hucre(r.residual) + '</dd></div>';
    h += '<div><dt>Durma nedeni</dt><dd><span class="reason-badge ' + rozetSinif + '">' + escapeHtml(r.stopLabel || '—') + '</span></dd></div>';
    h += '</dl>';
    kutu.innerHTML = h;
  }

  // ---- Cobweb ------------------------------------------------------------
  function cobwebCiz() {
    if (!sonSonuc || !sonSonuc.ok || !sonSonuc.rows.length || !window.Cobweb) return;
    var canvas = $('cobweb');
    try {
      var bilgi = window.Cobweb.draw(canvas, {
        rows: sonSonuc.rows,
        g: sonG,
        converged: sonSonuc.converged,
        root: sonSonuc.root
      });
      $('cobweb-not').textContent = bilgi && bilgi.note ? bilgi.note : '';
    } catch (e) {
      $('cobweb-not').textContent = 'Diyagram çizilemedi: ' + e.message;
    }
  }

  // ---- Kopyalama ve CSV --------------------------------------------------
  // Türkçe Excel için: ondalık ayırıcı virgül, tam hassasiyet.
  function trSayi(v) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'number' || !isFinite(v)) return String(v);
    return String(Number(v.toPrecision(15))).replace('.', ',');
  }

  function tabloSatirlari(r) {
    var satirlar = [['k', 'x_k', 'g(x_k)', 'hata |x_k - x_(k-1)|', "|g'(x_k)|"]];
    r.rows.forEach(function (row) {
      var g = row.gx !== null ? trSayi(row.gx) : (row.gKind === 'complex' ? 'gerçek değil' : (row.gKind === 'skip' ? '' : 'tanımsız'));
      satirlar.push([String(row.k), trSayi(row.x), g, row.error === null ? '—' : trSayi(row.error),
        row.absDg === null ? '' : trSayi(row.absDg)]);
    });
    return satirlar;
  }

  function ozetSatirlari(r) {
    return [
      [],
      ['Fonksiyon', (r.mode === 'f' ? 'f(x) = ' + r.func.inputText + ' ; g(x) = x - f(x)' : 'g(x) = ' + r.func.gText)],
      ['x0', trSayi(r.x0)],
      ['epsilon', trSayi(r.tol)],
      ['Nmax', String(r.nmax)],
      ['Toplam adım sayısı', String(r.iterations)],
      [r.converged ? 'Bulunan kök' : 'Son değer', trSayi(r.root)],
      ['Son hata', r.lastError === null ? '' : trSayi(r.lastError)],
      ['Durma nedeni', r.stopLabel || '']
    ];
  }

  function csvAlan(s) {
    s = String(s);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function durumYaz(m) {
    $('kopya-durum').textContent = m;
  }

  function panoyaKopyala() {
    if (!sonSonuc || !sonSonuc.ok) return;
    var metin = tabloSatirlari(sonSonuc).map(function (s) { return s.join('\t'); }).join('\n') + '\n';
    var yedek = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = metin;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        durumYaz(ok ? 'Tablo panoya kopyalandı (sekmeyle ayrılmış; Excel/Word\'e yapıştırılabilir).' : 'Kopyalanamadı. Tarayıcı panoya erişime izin vermiyor.');
      } catch (e) {
        durumYaz('Kopyalanamadı: ' + e.message);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(metin).then(function () {
        durumYaz('Tablo panoya kopyalandı (sekmeyle ayrılmış; Excel/Word\'e yapıştırılabilir).');
      }, yedek);
    } else {
      yedek();
    }
  }

  function csvIndir() {
    if (!sonSonuc || !sonSonuc.ok) return;
    var satirlar = tabloSatirlari(sonSonuc).concat(ozetSatirlari(sonSonuc));
    var metin = satirlar.map(function (s) { return s.map(csvAlan).join(';'); }).join('\r\n') + '\r\n';
    try {
      var blob = new Blob(['﻿' + metin], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'sabit-nokta-iterasyonu.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      durumYaz('CSV indirildi (; ayraçlı, UTF-8 BOM; Excel Türkçe ayarında doğrudan açılır).');
    } catch (e) {
      durumYaz('CSV oluşturulamadı: ' + e.message);
    }
  }

  // ---- Başlatma ----------------------------------------------------------
  function baslat() {
    renderStaticTex(document);
    temaKurulumu();

    if (!window.math || !FP) {
      $('bos-durum').hidden = true;
      $('sonuc-alani').hidden = false;
      $('yontem').hidden = true;
      $('tablo-bolumu').hidden = true;
      $('ozet').hidden = true;
      $('cobweb-bolumu').hidden = true;
      $('mesajlar').innerHTML = '<div class="alert alert-error" role="alert"><strong>Kütüphane yüklenemedi</strong>' +
        '<div>vendor/mathjs/math.js veya solver.js bulunamadı. Klasör yapısını bozmadan index.html dosyasını açın.</div></div>';
      return;
    }

    ornekleriKur();
    var radyolar = document.querySelectorAll('input[name="mode"], input[name="startMode"]');
    for (var i = 0; i < radyolar.length; i++) radyolar[i].addEventListener('change', modGorunumu);

    var zamanlayici = null;
    $('expr').addEventListener('input', function () {
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(onizlemeGuncelle, 120);
    });

    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      hesapla();
    });
    $('kopyala').addEventListener('click', panoyaKopyala);
    $('temizle').addEventListener('click', temizle);
    $('csv-indir').addEventListener('click', csvIndir);

    var yenidenCiz = null;
    window.addEventListener('resize', function () {
      clearTimeout(yenidenCiz);
      yenidenCiz = setTimeout(cobwebCiz, 150);
    });

    modGorunumu();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', baslat);
  else baslat();
})();
