/*
 * solver.js — Sabit Nokta İterasyonu hesap çekirdeği
 *
 * Bu dosya arayüzden (DOM'dan) tamamen bağımsızdır. Tek giriş noktası
 * FixedPoint.solve(params, math) fonksiyonudur: parametre nesnesi alır,
 * düz bir sonuç nesnesi döndürür. Hiçbir durumda istisna fırlatmaz; tüm
 * sorunlar sonuç nesnesindeki errors / warnings listelerine yazılır.
 *
 * Tarayıcıda window.FixedPoint olarak, Node.js'te require('./solver.js')
 * ile kullanılabilir (ES module değildir, file:// ile açılınca da çalışır).
 *
 * Python'a taşırken: math.js'in yerini sympy (ayrıştırma + türev) alabilir;
 * akış aynı kalır: normalize → ayrıştır/doğrula → g ve g' kur →
 * aralık analizi → iterasyon → sonuç nesnesi.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FixedPoint = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Sabitler -----------------------------------------------------------

  var BUYUK_DEGER = 1e12;        // |x| bunu aşarsa ıraksama kabul edilir
  var NMAX_UST_SINIR = 10000;    // arayüzün kilitlenmemesi için üst sınır
  var ARALIK_ORNEK_SAYISI = 400; // aralık analizinde örnek nokta sayısı
  var BUYUME_ESIGI = 3;          // ardışık bu kadar adım hata büyürse uyarı

  // İfadede kullanılabilecek fonksiyonlar (math.js adlarıyla).
  var IZINLI_FONKSIYONLAR = [
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'exp', 'log', 'log10', 'log2', 'sqrt', 'cbrt', 'nthRoot',
    'abs', 'pow', 'sign'
  ];
  // x dışında izin verilen semboller (sabitler).
  var IZINLI_SABITLER = ['e', 'pi', 'E', 'PI'];

  var DURMA_NEDENLERI = {
    tolerans: 'Tolerans sağlandı',
    nmax: 'Nmax aşıldı — yakınsama sağlanamadı',
    iraksama: 'Iraksadı — değerler aşırı büyüdü',
    tanimsiz: 'Durduruldu — g(x) tanımsız (NaN veya sonsuz)',
    gercekDegil: 'Durduruldu — g(x) bu noktada gerçek değil'
  };

  // ---- Yardımcılar --------------------------------------------------------

  function mesaj(kod, metin) {
    return { code: kod, message: metin };
  }

  // Sayıyı arayüz ve mesajlar için biçimlendirir (10 anlamlı basamak).
  function formatNumber(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v !== 'number') return String(v);
    if (isNaN(v)) return 'NaN';
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a < 1e-4 || a >= 1e9) return v.toExponential(6);
    return String(Number(v.toPrecision(10)));
  }

  // Kullanıcının yazdığı metni math.js'in anlayacağı biçime yaklaştırır.
  function normalizeExpression(text) {
    return String(text)
      .replace(/[−–—]/g, '-')       // Unicode eksi/tire işaretleri
      .replace(/[×·∙]/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/g, 'pi')
      .replace(/√/g, 'sqrt')
      .replace(/\*\*/g, '^')
      .trim();
  }

  // "x = cos(x)", "g(x) = ...", "f(x) = ...", "... = 0" gibi yazımları temizler.
  function stripEquation(text, mode) {
    var s = text;
    if (mode === 'g') {
      s = s.replace(/^\s*(g\s*\(\s*x\s*\)|x)\s*=\s*/, '');
    } else {
      s = s.replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/, '');
      s = s.replace(/\s*=\s*0+(\.0*)?\s*$/, '');
    }
    return s;
  }

  // Sayı girişini çözümler: nokta ve virgül ondalık ayırıcı olarak kabul edilir.
  // Ayrıca "1e-6", "10^-6", "pi/4" gibi sabit ifadeler de kabul edilir.
  function parseNumber(text, math) {
    if (text === null || text === undefined) return { ok: false, reason: 'bos' };
    if (typeof text === 'number') {
      return isFinite(text) ? { ok: true, value: text } : { ok: false, reason: 'gecersiz' };
    }
    var s = normalizeExpression(text).replace(/\s+/g, '');
    if (s === '') return { ok: false, reason: 'bos' };
    s = s.replace(/,/g, '.');
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      return { ok: true, value: Number(s) };
    }
    // Sabit ifade denemesi (değişken içermemeli).
    if (math) {
      try {
        var node = math.parse(s);
        var semboller = node.filter(function (n, path, parent) {
          return n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn');
        });
        var hepsiSabit = semboller.every(function (n) {
          return IZINLI_SABITLER.indexOf(n.name) !== -1;
        });
        if (hepsiSabit) {
          var v = node.compile().evaluate({});
          if (typeof v === 'number' && isFinite(v)) return { ok: true, value: v };
        }
      } catch (e) { /* aşağıda geçersiz döner */ }
    }
    return { ok: false, reason: 'gecersiz' };
  }

  // math.js sonucunun gerçek bir sayı olup olmadığını sınıflandırır.
  // Dönüş: { kind: 'real' | 'complex' | 'nan' | 'inf' | 'other', value }
  function classify(v) {
    if (typeof v === 'number') {
      if (isNaN(v)) return { kind: 'nan', value: v };
      if (!isFinite(v)) return { kind: 'inf', value: v };
      return { kind: 'real', value: v };
    }
    if (v && typeof v === 'object' && typeof v.re === 'number' && typeof v.im === 'number') {
      if (v.im === 0) return classify(v.re);
      return { kind: 'complex', value: v };
    }
    if (v && typeof v === 'object' && typeof v.toNumber === 'function') {
      try { return classify(v.toNumber()); } catch (e) { /* diğer */ }
    }
    return { kind: 'other', value: v };
  }

  // KaTeX çıktısında math.js'in log(x) yazımını ln(x) olarak göster.
  function texHandler(node, options) {
    if (node.type === 'FunctionNode' && node.fn && node.fn.name === 'log' && node.args.length === 1) {
      return '\\ln\\left(' + node.args[0].toTex(options) + '\\right)';
    }
    return undefined;
  }

  function toTex(node) {
    try {
      return node.toTex({ implicit: 'hide', parenthesis: 'keep', handler: texHandler });
    } catch (e) {
      return null;
    }
  }

  // ---- İfade ayrıştırma ve doğrulama --------------------------------------

  /*
   * Kullanıcı ifadesini ayrıştırır ve g(x) için bir düğüm (node) kurar.
   * f modunda g(x) = x − f(x) olarak oluşturulur.
   * Dönüş: { ok, error, inputNode, gNode, gText, gTex, inputTex, simplifiedTex }
   */
  function buildFunction(exprText, mode, math) {
    if (exprText === null || exprText === undefined || String(exprText).trim() === '') {
      return { ok: false, error: mesaj('ifade-bos', 'Fonksiyon ifadesi boş. Örneğin cos(x) yazın.') };
    }
    var s = stripEquation(normalizeExpression(exprText), mode);
    if (s === '') {
      return { ok: false, error: mesaj('ifade-bos', 'Fonksiyon ifadesi boş. Örneğin cos(x) yazın.') };
    }

    var node;
    try {
      node = math.parse(s);
    } catch (e) {
      var ek = '';
      if (/,/.test(s) && /Unexpected operator ,|Unexpected ","/.test(e.message || '')) {
        ek = ' İfadede ondalık ayırıcı olarak nokta kullanın (ör. 0.5).';
      } else if (/Parenthesis \) expected/.test(e.message || '')) {
        ek = ' Kapanmamış parantez var.';
      }
      return {
        ok: false,
        error: mesaj('sozdizimi', 'İfade ayrıştırılamadı: "' + s + '".' + ek + ' (Ayrıntı: ' + (e.message || e) + ')')
      };
    }

    // ln(...) → log(...) (math.js'te log tek argümanla doğal logaritmadır).
    var lnHatasi = null;
    node = node.transform(function (n) {
      if (n.isFunctionNode && n.fn && n.fn.name === 'ln') {
        if (n.args.length !== 1) lnHatasi = mesaj('sozdizimi', 'ln fonksiyonu tek argüman alır: ln(x).');
        return new math.FunctionNode(new math.SymbolNode('log'), n.args);
      }
      return n;
    });
    if (lnHatasi) return { ok: false, error: lnHatasi };

    // Yapı kontrolü: atama, karşılaştırma, matris vb. kabul edilmez.
    var yapiHatasi = null;
    node.traverse(function (n, path, parent) {
      if (yapiHatasi) return;
      if (n.isAssignmentNode || n.isFunctionAssignmentNode) {
        yapiHatasi = mesaj('sozdizimi', 'İfadede birden fazla "=" veya atama var. Yalnızca sağ tarafı yazın, ör. cos(x).');
      } else if (n.isArrayNode || n.isIndexNode || n.isAccessorNode || n.isObjectNode ||
                 n.isRangeNode || n.isBlockNode || n.isConditionalNode) {
        yapiHatasi = mesaj('sozdizimi', 'İfade desteklenmeyen bir yapı içeriyor (dizi, aralık, koşul vb.). Tek değişkenli bir matematiksel ifade yazın.');
      } else if (n.isOperatorNode && ['==', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'xor'].indexOf(n.op) !== -1) {
        yapiHatasi = mesaj('sozdizimi', 'İfadede karşılaştırma veya mantık işleci (' + n.op + ') kullanılamaz.');
      } else if (n.isFunctionNode) {
        var ad = n.fn && n.fn.name;
        if (!ad) {
          yapiHatasi = mesaj('sozdizimi', 'Fonksiyon çağrısı anlaşılamadı.');
        } else if (IZINLI_FONKSIYONLAR.indexOf(ad) === -1) {
          yapiHatasi = mesaj('bilinmeyen-fonksiyon', 'Bilinmeyen veya desteklenmeyen fonksiyon: "' + ad +
            '". Kullanılabilenler: sin, cos, tan, exp, ln, log10, sqrt, cbrt, abs, sinh, cosh, asin, acos, atan …');
        }
      } else if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn')) {
        if (n.name !== 'x' && IZINLI_SABITLER.indexOf(n.name) === -1) {
          var ipucu = /x/.test(n.name) && n.name.length > 1
            ? ' Çarpım için araya * koyun (ör. "' + n.name.split('').join('*') + '").'
            : '';
          if (IZINLI_FONKSIYONLAR.indexOf(n.name) !== -1 || n.name === 'ln') {
            ipucu = ' Fonksiyonu parantezle yazın, ör. ' + n.name + '(x).';
          }
          yapiHatasi = mesaj('bilinmeyen-degisken', 'Bilinmeyen değişken: "' + n.name +
            '". Yalnızca x değişkeni ile e ve pi sabitleri kullanılabilir.' + ipucu);
        }
      }
    });
    if (yapiHatasi) return { ok: false, error: yapiHatasi };

    var inputNode = node;
    var gNode = node;
    if (mode === 'f') {
      gNode = new math.OperatorNode('-', 'subtract', [
        new math.SymbolNode('x'),
        new math.ParenthesisNode(inputNode)
      ]);
    }

    var simplifiedTex = null;
    if (mode === 'f') {
      try {
        var sade = math.simplify(gNode);
        var t = toTex(sade);
        if (t && t !== toTex(gNode)) simplifiedTex = t;
      } catch (e) { /* sadeleştirme yalnızca gösterim için */ }
    }

    var compiled;
    try {
      compiled = gNode.compile();
    } catch (e) {
      return { ok: false, error: mesaj('sozdizimi', 'İfade derlenemedi: ' + (e.message || e)) };
    }

    return {
      ok: true,
      inputNode: inputNode,
      gNode: gNode,
      compiled: compiled,
      inputText: inputNode.toString(),
      gText: gNode.toString(),
      inputTex: toTex(inputNode),
      gTex: toTex(gNode),
      simplifiedTex: simplifiedTex
    };
  }

  // g(x)'i güvenli biçimde hesaplar; asla istisna fırlatmaz.
  function makeEvaluator(compiled) {
    return function (x) {
      try {
        return classify(compiled.evaluate({ x: x }));
      } catch (e) {
        return { kind: 'error', value: null, message: e.message || String(e) };
      }
    };
  }

  /*
   * g'(x) hesaplayıcısı kurar. Önce math.js ile sembolik türev denenir;
   * olmazsa merkezi fark kullanılır: g'(x) ≈ (g(x+h) − g(x−h)) / 2h.
   */
  function buildDerivative(gNode, evalG, math) {
    var sembolik = null;
    var dTex = null;
    try {
      var d = math.derivative(gNode, 'x');
      sembolik = d.compile();
      dTex = toTex(d);
    } catch (e) {
      sembolik = null;
    }

    function merkeziFark(x) {
      var h = 1e-6 * Math.max(1, Math.abs(x));
      var ileri = evalG(x + h);
      var geri = evalG(x - h);
      if (ileri.kind !== 'real' || geri.kind !== 'real') return { kind: 'nan', value: NaN };
      return classify((ileri.value - geri.value) / (2 * h));
    }

    return {
      method: sembolik ? 'sembolik' : 'sayisal',
      tex: dTex,
      evaluate: function (x) {
        if (sembolik) {
          try {
            var r = classify(sembolik.evaluate({ x: x }));
            if (r.kind === 'real') return r;
          } catch (e) { /* sayısal yönteme düş */ }
        }
        return merkeziFark(x);
      }
    };
  }

  // ---- Aralık analizi -----------------------------------------------------

  /*
   * [a, b] aralığında g ve g' örneklenir:
   *   - max |g'(x)| < 1 mi? (daralma koşulu)
   *   - g([a, b]) ⊆ [a, b] mi? (aralığı kendi içine taşıma)
   * Bu kontroller örneklemeye dayanır; kesin matematiksel kanıt değildir.
   */
  function analyzeInterval(a, b, evalG, deriv) {
    var n = ARALIK_ORNEK_SAYISI;
    var maxAbsDg = 0, maxAbsDgAt = a;
    var gMin = Infinity, gMax = -Infinity;
    var tanimsizSayisi = 0, ilkTanimsiz = null;
    var dgBilinmiyor = 0;

    for (var i = 0; i <= n; i++) {
      var t = a + (b - a) * i / n;
      var g = evalG(t);
      if (g.kind !== 'real') {
        tanimsizSayisi++;
        if (ilkTanimsiz === null) ilkTanimsiz = t;
        continue;
      }
      if (g.value < gMin) gMin = g.value;
      if (g.value > gMax) gMax = g.value;
      var d = deriv.evaluate(t);
      if (d.kind === 'real') {
        if (Math.abs(d.value) > maxAbsDg) { maxAbsDg = Math.abs(d.value); maxAbsDgAt = t; }
      } else {
        dgBilinmiyor++;
      }
    }

    var pay = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
    var tanimliHerYerde = tanimsizSayisi === 0;
    return {
      a: a,
      b: b,
      samples: n + 1,
      definedEverywhere: tanimliHerYerde,
      undefinedCount: tanimsizSayisi,
      firstUndefinedAt: ilkTanimsiz,
      gMin: isFinite(gMin) ? gMin : null,
      gMax: isFinite(gMax) ? gMax : null,
      mapsInto: tanimliHerYerde && gMin >= a - pay && gMax <= b + pay,
      maxAbsDg: dgBilinmiyor === 0 ? maxAbsDg : (maxAbsDg > 0 ? maxAbsDg : null),
      maxAbsDgAt: maxAbsDgAt,
      derivativeUnknownCount: dgBilinmiyor,
      contraction: dgBilinmiyor === 0 && tanimliHerYerde && maxAbsDg < 1
    };
  }

  // ---- Ana fonksiyon ------------------------------------------------------

  /*
   * params = {
   *   mode:      'g' (x = g(x))  |  'f' (f(x) = 0, g(x) = x − f(x)),
   *   expr:      fonksiyon metni,
   *   startMode: 'x0' | 'interval',
   *   x0, a, b:  başlangıç (metin veya sayı),
   *   tol:       ε (metin veya sayı),
   *   nmax:      en fazla iterasyon sayısı (metin veya sayı)
   * }
   * math: math.js nesnesi (tarayıcıda global math, Node'da require ile).
   */
  function solve(params, math) {
    var sonuc = {
      ok: false,
      errors: [],
      warnings: [],
      notes: [],
      mode: null,
      startMode: null,
      func: null,
      derivative: null,
      x0: null,
      tol: null,
      nmax: null,
      interval: null,
      rows: [],
      stopReason: null,
      stopLabel: null,
      converged: false,
      root: null,
      iterations: 0,
      lastError: null,
      residual: null
    };

    try {
      math = math || (typeof self !== 'undefined' ? self.math : undefined);
      if (!math || typeof math.parse !== 'function') {
        sonuc.errors.push(mesaj('kutuphane', 'math.js yüklenemedi. vendor/mathjs/math.js dosyasının yerinde olduğundan emin olun.'));
        return sonuc;
      }
      params = params || {};
      var mode = params.mode === 'f' ? 'f' : 'g';
      var startMode = params.startMode === 'interval' ? 'interval' : 'x0';
      sonuc.mode = mode;
      sonuc.startMode = startMode;

      // 1) Fonksiyon
      var fn = buildFunction(params.expr, mode, math);
      if (!fn.ok) sonuc.errors.push(fn.error);

      // 2) Sayısal girdiler
      var a = null, b = null, x0 = null;
      if (startMode === 'x0') {
        var px = parseNumber(params.x0, math);
        if (!px.ok) {
          sonuc.errors.push(mesaj('x0', px.reason === 'bos'
            ? 'Başlangıç değeri x₀ boş.'
            : 'Başlangıç değeri x₀ geçerli bir sayı değil: "' + params.x0 + '".'));
        } else {
          x0 = px.value;
        }
      } else {
        var pa = parseNumber(params.a, math);
        var pb = parseNumber(params.b, math);
        if (!pa.ok) sonuc.errors.push(mesaj('a', pa.reason === 'bos'
          ? 'Aralığın sol ucu a boş.' : 'Aralığın sol ucu a geçerli bir sayı değil: "' + params.a + '".'));
        if (!pb.ok) sonuc.errors.push(mesaj('b', pb.reason === 'bos'
          ? 'Aralığın sağ ucu b boş.' : 'Aralığın sağ ucu b geçerli bir sayı değil: "' + params.b + '".'));
        if (pa.ok && pb.ok) {
          if (pa.value >= pb.value) {
            sonuc.errors.push(mesaj('aralik', 'Aralık geçersiz: a < b olmalı (girilen a = ' +
              formatNumber(pa.value) + ', b = ' + formatNumber(pb.value) + ').'));
          } else {
            a = pa.value; b = pb.value;
            x0 = (a + b) / 2;
          }
        }
      }

      var pt = parseNumber(params.tol, math);
      var tol = null;
      if (!pt.ok) {
        sonuc.errors.push(mesaj('tol', pt.reason === 'bos'
          ? 'Tolerans ε boş.' : 'Tolerans ε geçerli bir sayı değil: "' + params.tol + '".'));
      } else if (pt.value <= 0) {
        sonuc.errors.push(mesaj('tol', 'Tolerans ε pozitif olmalı (ε > 0). Örneğin 1e-6 veya 0,000001 yazın.'));
      } else {
        tol = pt.value;
      }

      var pn = parseNumber(params.nmax, math);
      var nmax = null;
      if (!pn.ok) {
        sonuc.errors.push(mesaj('nmax', pn.reason === 'bos'
          ? 'Nmax boş.' : 'Nmax geçerli bir sayı değil: "' + params.nmax + '".'));
      } else if (pn.value !== Math.floor(pn.value) || pn.value < 1) {
        sonuc.errors.push(mesaj('nmax', 'Nmax 1 veya daha büyük bir tam sayı olmalı.'));
      } else if (pn.value > NMAX_UST_SINIR) {
        sonuc.errors.push(mesaj('nmax', 'Nmax en fazla ' + NMAX_UST_SINIR + ' olabilir.'));
      } else {
        nmax = pn.value;
      }

      if (sonuc.errors.length > 0) return sonuc;

      sonuc.x0 = x0;
      sonuc.tol = tol;
      sonuc.nmax = nmax;
      sonuc.func = {
        inputText: fn.inputText,
        gText: fn.gText,
        inputTex: fn.inputTex,
        gTex: fn.gTex,
        simplifiedTex: fn.simplifiedTex
      };

      if (tol < 1e-15) {
        sonuc.warnings.push(mesaj('tol-kucuk', 'ε = ' + formatNumber(tol) +
          ' çok küçük; kayan nokta hassasiyeti (~1e-16) nedeniyle tolerans hiç sağlanamayabilir.'));
      }

      var evalG = makeEvaluator(fn.compiled);
      var deriv = buildDerivative(fn.gNode, evalG, math);
      sonuc.derivative = { method: deriv.method, tex: deriv.tex };
      if (deriv.method === 'sayisal') {
        sonuc.notes.push(mesaj('turev-sayisal', "g'(x) sembolik olarak alınamadı; merkezi fark ile yaklaşık hesaplanıyor."));
      }

      if (mode === 'f') {
        sonuc.notes.push(mesaj('f-modu',
          'f(x) = 0 modunda g(x) = x − f(x) kullanılır. Bu seçim yalnızca kök civarında |1 − f′(x)| < 1 ise yakınsar; ' +
          'çoğu f için yakınsamaz. Bu, yöntemin bilinen bir sınırlamasıdır.'));
      }

      sonuc.ok = true;

      // 3) Aralık analizi
      if (startMode === 'interval') {
        var an = analyzeInterval(a, b, evalG, deriv);
        sonuc.interval = an;
        if (!an.definedEverywhere) {
          sonuc.warnings.push(mesaj('aralik-tanimsiz', 'g(x), [' + formatNumber(a) + ', ' + formatNumber(b) +
            '] aralığının bazı noktalarında gerçek değil veya tanımsız (ilk örnek: x ≈ ' +
            formatNumber(an.firstUndefinedAt) + '). Yakınsama koşulları bu aralıkta sağlanmıyor.'));
        }
        if (an.maxAbsDg !== null && an.maxAbsDg >= 1) {
          sonuc.warnings.push(mesaj('aralik-turev', "Aralıkta max |g′(x)| ≈ " + formatNumber(an.maxAbsDg) +
            ' ≥ 1 (x ≈ ' + formatNumber(an.maxAbsDgAt) + ' civarında). Daralma koşulu sağlanmıyor; yakınsama garanti değil.'));
        }
        if (an.definedEverywhere && !an.mapsInto) {
          sonuc.warnings.push(mesaj('aralik-tasima', 'g, [a, b] aralığını kendi içine taşımıyor: aralıkta g(x) değerleri [' +
            formatNumber(an.gMin) + ', ' + formatNumber(an.gMax) + '] arasında. Sabit noktanın bu aralıkta olacağı garanti değil.'));
        }
        if (an.contraction && an.mapsInto) {
          sonuc.notes.push(mesaj('aralik-uygun', 'Örnekleme sonucu: g([a, b]) ⊆ [a, b] ve max |g′(x)| ≈ ' +
            formatNumber(an.maxAbsDg) + ' < 1. Bu aralıkta tek bir sabit nokta vardır ve iterasyon yakınsar ' +
            '(örneklemeye dayalı kontrol; kesin kanıt değildir).'));
        }
      }

      // 4) İterasyon
      iterate(sonuc, evalG, deriv, x0, tol, nmax);

      // 5) Sonuca göre ek uyarılar
      if (!sonuc.converged && mode === 'f') {
        sonuc.warnings.push(mesaj('f-oneri',
          'Öneri: g(x) = x − f(x) bu fonksiyon için yakınsamadı. f(x) = 0 denklemini x = g(x) biçimine kendiniz dönüştürmeyi ' +
          'deneyin (ör. x³ − x − 2 = 0 için g(x) = (x + 2)^(1/3)) ve "x = g(x)" modunu kullanın.'));
      }
    } catch (e) {
      // Beklenmeyen bir durumda bile çökme yerine anlaşılır bir mesaj ver.
      sonuc.ok = false;
      sonuc.errors.push(mesaj('beklenmeyen', 'Beklenmeyen bir hata oluştu: ' + (e && e.message ? e.message : e)));
    }
    return sonuc;
  }

  /*
   * İterasyon döngüsü. Tablo satırı k:
   *   x_k, g(x_k) (= x_{k+1}), hata_k = |x_k − x_{k−1}| (k = 0 için yok), |g′(x_k)|
   * hata_k < ε olduğunda durulur ve kök x_k olarak sunulur.
   */
  function iterate(sonuc, evalG, deriv, x0, tol, nmax) {
    var rows = sonuc.rows;
    var buyukTurevAdimlari = [];
    var ardisikBuyume = 0;
    var buyumeUyarisiVerildi = false;
    var oncekiHata = null;
    var x = x0;
    var oncekiX = null;

    for (var k = 0; k <= nmax; k++) {
      if (Math.abs(x) > BUYUK_DEGER) {
        rows.push({ k: k, x: x, gx: null, error: oncekiX === null ? null : Math.abs(x - oncekiX), absDg: null, gKind: 'skip' });
        bitir(sonuc, 'iraksama', k, x);
        sonuc.warnings.push(mesaj('iraksama', 'Iraksama: x_' + k + ' = ' + formatNumber(x) + ' değeri |x| > 10¹² sınırını aştı. İterasyon durduruldu.'));
        break;
      }

      var hata = oncekiX === null ? null : Math.abs(x - oncekiX);
      var g = evalG(x);
      var d = deriv.evaluate(x);
      var absDg = d.kind === 'real' ? Math.abs(d.value) : null;
      var row = {
        k: k,
        x: x,
        gx: g.kind === 'real' ? g.value : null,
        gKind: g.kind,
        error: hata,
        absDg: absDg,
        dgTooLarge: absDg !== null && absDg >= 1
      };
      rows.push(row);
      if (row.dgTooLarge) buyukTurevAdimlari.push(k);

      // Hata büyümesi takibi (ıraksama eğilimi).
      if (hata !== null && oncekiHata !== null) {
        if (hata > oncekiHata) ardisikBuyume++; else ardisikBuyume = 0;
        if (ardisikBuyume >= BUYUME_ESIGI && !buyumeUyarisiVerildi) {
          buyumeUyarisiVerildi = true;
          sonuc.warnings.push(mesaj('hata-buyuyor', 'Iraksama eğilimi: hata ' + (BUYUME_ESIGI + 1) +
            ' ardışık adımda sürekli büyüdü (k = ' + (k - BUYUME_ESIGI) + ' … ' + k + '). İterasyon ıraksıyor olabilir.'));
        }
      }
      if (hata !== null) oncekiHata = hata;

      // Tolerans kontrolü
      if (hata !== null && hata < tol) {
        bitir(sonuc, 'tolerans', k, x);
        sonuc.converged = true;
        break;
      }

      // g(x_k) gerçek bir sayı mı?
      if (g.kind !== 'real') {
        if (g.kind === 'complex') {
          bitir(sonuc, 'gercekDegil', k, x);
          sonuc.errors.push(mesaj('karmasik', 'g(x) bu noktada gerçek değil: x_' + k + ' = ' + formatNumber(x) +
            ' için g(x) karmaşık bir sayı veriyor (' + String(g.value) + '). Örneğin negatif bir sayının karekökü ' +
            'veya logaritması alınıyor olabilir. Not: negatif tabanın kesirli kuvveti, ör. (−8)^(1/3), math.js\'te ' +
            'karmaşık sonuç verir; gerçek küp kök için cbrt(x) kullanın.'));
        } else if (g.kind === 'other') {
          bitir(sonuc, 'tanimsiz', k, x);
          sonuc.errors.push(mesaj('tanimsiz', 'g(x_' + k + ') bir sayı üretmedi. İfadeyi kontrol edin.'));
        } else {
          bitir(sonuc, 'tanimsiz', k, x);
          sonuc.errors.push(mesaj('tanimsiz', 'g(x) tanımsız: x_' + k + ' = ' + formatNumber(x) + ' için g(x) = ' +
            (g.kind === 'inf' ? '∞' : g.kind === 'nan' ? 'NaN' : 'hesaplanamadı' + (g.message ? ' (' + g.message + ')' : '')) +
            '. Sıfıra bölme veya tanım kümesi dışında bir değer olabilir.'));
        }
        break;
      }

      if (k === nmax) {
        bitir(sonuc, 'nmax', k, x);
        sonuc.warnings.push(mesaj('nmax', 'Yakınsama sağlanamadı: Nmax = ' + nmax + ' iterasyona ulaşıldı ancak tolerans ' +
          '(ε = ' + formatNumber(tol) + ') sağlanmadı. Son değer x_' + k + ' = ' + formatNumber(x) + ' gösteriliyor.'));
        break;
      }

      oncekiX = x;
      x = g.value;
    }

    if (buyukTurevAdimlari.length > 0) {
      var liste = buyukTurevAdimlari.slice(0, 12).join(', ') + (buyukTurevAdimlari.length > 12 ? ', …' : '');
      sonuc.warnings.push(mesaj('turev-buyuk', "|g′(x_k)| ≥ 1 olan adımlar var (k = " + liste + '; toplam ' +
        buyukTurevAdimlari.length + ' adım). Bu bölgede iterasyon sabit noktadan uzaklaşma eğilimindedir; ' +
        'yakınsama garanti değildir. İterasyon yine de sürdürüldü.'));
    }

    // Yakınsadıysa, kökteki türev ve artık değer kontrolü.
    if (sonuc.converged) {
      var son = rows[rows.length - 1];
      if (son.gx !== null) sonuc.residual = Math.abs(son.gx - son.x);
      if (son.absDg !== null && son.absDg >= 1) {
        sonuc.warnings.push(mesaj('kok-turev', "Tolerans sağlandı ancak bulunan noktada |g′(x)| ≈ " + formatNumber(son.absDg) +
          ' ≥ 1. Bu nokta itici (kararsız) bir sabit nokta olabilir veya adımlar yalnızca çok küçülmüş olabilir; ' +
          '|g(x) − x| değerini kontrol edin.'));
      }
    }
  }

  function bitir(sonuc, neden, k, x) {
    sonuc.stopReason = neden;
    sonuc.stopLabel = DURMA_NEDENLERI[neden];
    sonuc.iterations = k;
    sonuc.root = x;
    var son = sonuc.rows[sonuc.rows.length - 1];
    sonuc.lastError = son ? son.error : null;
  }

  return {
    solve: solve,
    buildFunction: buildFunction,
    makeEvaluator: makeEvaluator,
    parseNumber: parseNumber,
    formatNumber: formatNumber,
    constants: {
      BUYUK_DEGER: BUYUK_DEGER,
      NMAX_UST_SINIR: NMAX_UST_SINIR,
      DURMA_NEDENLERI: DURMA_NEDENLERI
    }
  };
});
