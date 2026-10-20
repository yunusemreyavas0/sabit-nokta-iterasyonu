/*
 * solver.js için Node.js testleri.
 * Çalıştırma:  node tests/solver.test.js
 * Bağımlılık yok; yalnızca vendor/ içindeki math.js kullanılır.
 */
'use strict';

var path = require('path');
var math = require(path.join(__dirname, '..', 'vendor', 'mathjs', 'math.js'));
var FP = require(path.join(__dirname, '..', 'solver.js'));

var gecen = 0, kalan = 0;

function kontrol(ad, kosul, ayrinti) {
  if (kosul) { gecen++; console.log('  ✓ ' + ad); }
  else { kalan++; console.log('  ✗ ' + ad + (ayrinti ? '  → ' + ayrinti : '')); }
}

function kodlar(liste) { return liste.map(function (m) { return m.code; }); }

function ozet(r) {
  console.log('    durma nedeni : ' + r.stopReason + ' (' + r.stopLabel + ')');
  console.log('    adım sayısı  : ' + r.iterations);
  console.log('    kök / son x  : ' + (r.root === null ? '—' : r.root.toPrecision(12)));
  console.log('    son hata     : ' + FP.formatNumber(r.lastError));
  if (r.errors.length) r.errors.forEach(function (m) { console.log('    [HATA]  ' + m.message); });
  if (r.warnings.length) r.warnings.forEach(function (m) { console.log('    [UYARI] ' + m.message); });
  if (r.notes.length) r.notes.forEach(function (m) { console.log('    [NOT]   ' + m.message); });
}

function coz(p) {
  var tam = Object.assign({ mode: 'g', startMode: 'x0', tol: '1e-6', nmax: '100' }, p);
  var r;
  try { r = FP.solve(tam, math); }
  catch (e) { kalan++; console.log('  ✗ solve() istisna fırlattı: ' + e.message); return null; }
  return r;
}

// Bağımsız referans: Newton yöntemi ile f(x) = 0 kökü.
function newton(f, df, x) {
  for (var i = 0; i < 100; i++) x = x - f(x) / df(x);
  return x;
}

// ---------------------------------------------------------------------------
console.log('\n1) g(x) = cos(x), x0 = 0.5, ε = 1e-6');
var dottie = newton(function (x) { return x - Math.cos(x); }, function (x) { return 1 + Math.sin(x); }, 0.5);
console.log('    referans (Newton, x − cos x = 0): ' + dottie.toPrecision(12));
var r1 = coz({ expr: 'cos(x)', x0: '0.5' });
ozet(r1);
kontrol('yakınsadı (tolerans)', r1.converged && r1.stopReason === 'tolerans');
kontrol('kök ≈ 0.739085 (6 basamak)', Math.abs(r1.root - 0.739085) < 5e-7, r1.root);
kontrol('kök referansa 1e-5 içinde', Math.abs(r1.root - dottie) < 1e-5);
kontrol('k = 0 satırında hata yok', r1.rows[0].error === null);
kontrol("|g'(x)| sütunu dolu (sembolik)", r1.derivative.method === 'sembolik' &&
  Math.abs(r1.rows[0].absDg - Math.abs(Math.sin(0.5))) < 1e-12);
kontrol('son hata < ε', r1.lastError < 1e-6);
console.log('    ilk satırlar:');
r1.rows.slice(0, 4).forEach(function (row) {
  console.log('      k=' + row.k + '  x=' + FP.formatNumber(row.x) + '  g(x)=' + FP.formatNumber(row.gx) +
    '  hata=' + FP.formatNumber(row.error) + "  |g'|=" + FP.formatNumber(row.absDg));
});

// ---------------------------------------------------------------------------
console.log('\n2) g(x) = (x+2)^(1/3), x0 = 1');
var kok3 = newton(function (x) { return x * x * x - x - 2; }, function (x) { return 3 * x * x - 1; }, 1.5);
console.log('    referans (Newton, x³ − x − 2 = 0): ' + kok3.toPrecision(12) +
  '   kontrol: x³ − x − 2 = ' + (kok3 * kok3 * kok3 - kok3 - 2).toExponential(2));
var r2 = coz({ expr: '(x+2)^(1/3)', x0: '1' });
ozet(r2);
kontrol('yakınsadı', r2.converged);
kontrol('kök ≈ 1.5214', Math.abs(r2.root - 1.5214) < 1e-4, r2.root);
kontrol('kök referansa 1e-6 içinde', Math.abs(r2.root - kok3) < 1e-6);
kontrol('kök denklemi sağlıyor |x³ − x − 2| < 1e-5', Math.abs(Math.pow(r2.root, 3) - r2.root - 2) < 1e-5);

// ---------------------------------------------------------------------------
console.log('\n3) g(x) = x^2 + 1, x0 = 0 (ıraksama)');
var r3 = coz({ expr: 'x^2 + 1', x0: '0' });
ozet(r3);
kontrol('çökmedi, sonuç döndü', r3 && r3.ok);
kontrol('durma nedeni ıraksama', r3.stopReason === 'iraksama');
kontrol('ıraksama uyarısı var', kodlar(r3.warnings).indexOf('iraksama') !== -1);
kontrol('hata büyüyor uyarısı var', kodlar(r3.warnings).indexOf('hata-buyuyor') !== -1);
kontrol("|g'| ≥ 1 uyarısı var", kodlar(r3.warnings).indexOf('turev-buyuk') !== -1);
kontrol('yakınsadı denmiyor', !r3.converged);

// ---------------------------------------------------------------------------
console.log('\n4) g(x) = sqrt(x-5), x0 = 1 (karmaşık sonuç)');
var r4 = coz({ expr: 'sqrt(x-5)', x0: '1' });
ozet(r4);
kontrol('çökmedi', r4 !== null);
kontrol('durma nedeni: gerçek değil', r4.stopReason === 'gercekDegil');
kontrol('"gerçek değil" mesajı var', r4.errors.some(function (m) { return /gerçek değil/.test(m.message); }));

// ---------------------------------------------------------------------------
console.log('\n5) Boş ve bozuk girişler (hiçbiri istisna fırlatmamalı)');
var bozuklar = [
  ['boş ifade', { expr: '', x0: '1' }, 'ifade-bos'],
  ['yalnızca boşluk', { expr: '   ', x0: '1' }, 'ifade-bos'],
  ['kapanmamış parantez', { expr: 'cos(x', x0: '1' }, 'sozdizimi'],
  ['sözdizimi: x +* 2', { expr: 'x +* 2', x0: '1' }, 'sozdizimi'],
  ['bilinmeyen değişken y', { expr: 'y + 1', x0: '1' }, 'bilinmeyen-degisken'],
  ['bilinmeyen fonksiyon foo', { expr: 'foo(x)', x0: '1' }, 'bilinmeyen-fonksiyon'],
  ['ifadede ondalık virgül', { expr: 'x*0,5', x0: '1' }, 'sozdizimi'],
  ['boş x0', { expr: 'cos(x)', x0: '' }, 'x0'],
  ['harf x0', { expr: 'cos(x)', x0: 'abc' }, 'x0'],
  ['a >= b', { expr: 'cos(x)', startMode: 'interval', a: '2', b: '1' }, 'aralik'],
  ['a = b', { expr: 'cos(x)', startMode: 'interval', a: '1', b: '1' }, 'aralik'],
  ['boş b', { expr: 'cos(x)', startMode: 'interval', a: '0', b: '' }, 'b'],
  ['ε = 0', { expr: 'cos(x)', x0: '1', tol: '0' }, 'tol'],
  ['ε < 0', { expr: 'cos(x)', x0: '1', tol: '-1e-6' }, 'tol'],
  ['ε boş', { expr: 'cos(x)', x0: '1', tol: '' }, 'tol'],
  ['Nmax = 0', { expr: 'cos(x)', x0: '1', nmax: '0' }, 'nmax'],
  ['Nmax = 2.5', { expr: 'cos(x)', x0: '1', nmax: '2.5' }, 'nmax'],
  ['Nmax = abc', { expr: 'cos(x)', x0: '1', nmax: 'abc' }, 'nmax'],
  ['tamamen boş parametre', {}, 'ifade-bos']
];
bozuklar.forEach(function (t) {
  var r = coz(t[1]);
  var tamam = r && !r.ok && kodlar(r.errors).indexOf(t[2]) !== -1 && r.rows.length === 0;
  kontrol(t[0] + ' → "' + (r && r.errors[0] ? r.errors[0].message : '?') + '"', tamam,
    r ? JSON.stringify(kodlar(r.errors)) : 'null');
});
(function () {
  var r;
  try { r = FP.solve(null, math); kontrol('solve(null) çökmüyor', !r.ok && r.errors.length > 0); }
  catch (e) { kontrol('solve(null) çökmüyor', false, e.message); }
})();

// ---------------------------------------------------------------------------
console.log('\n6) Ek kontroller');
var r6 = coz({ expr: 'cos(x)', x0: '0,5', tol: '0,000001' });
kontrol('virgüllü ondalık (0,5 ve 0,000001) kabul ediliyor', r6.converged && Math.abs(r6.root - 0.739085) < 5e-7);
var r7 = coz({ mode: 'f', expr: 'x - cos(x)', x0: '0.5' });
kontrol('f modu: x − cos(x) → g = cos(x), yakınsar', r7.converged && Math.abs(r7.root - dottie) < 1e-5, r7.root);
kontrol('f modu sınırlama notu gösteriliyor', kodlar(r7.notes).indexOf('f-modu') !== -1);
var r8 = coz({ mode: 'f', expr: 'x^3 - x - 2', x0: '1.5' });
kontrol('f modu ıraksayan örnek: öneri uyarısı var', !r8.converged && kodlar(r8.warnings).indexOf('f-oneri') !== -1, r8.stopReason);
var r9 = coz({ expr: 'ln(x) + 2', x0: '1' });
kontrol('ln(x) doğal log olarak çalışıyor (x = ln x + 2 → 3.146193…)', r9.converged && Math.abs(r9.root - 3.1461932) < 1e-5, r9.root);
var r10 = coz({ expr: '0.5x + 1', x0: '0' });
kontrol('örtük çarpma 0.5x → kök 2', r10.converged && Math.abs(r10.root - 2) < 1e-5, r10.root);
var r11 = coz({ expr: 'exp(-x)', startMode: 'interval', a: '0.3', b: '1' });
kontrol('aralık modu: x0 = (a+b)/2 = 0.65', r11.x0 === 0.65);
kontrol('aralık modu exp(-x) [0.3,1]: g([a,b]) ⊆ [a,b] ve max|g′| ≈ 0.74 < 1 → "koşullar sağlanıyor" notu',
  r11.interval && r11.interval.contraction && r11.interval.mapsInto, JSON.stringify(r11.interval));
var r12 = coz({ expr: 'x^2 + 1', startMode: 'interval', a: '0', b: '2' });
kontrol('aralık modu x²+1 [0,2]: türev ve taşıma uyarısı, yine de hesaplanıyor',
  kodlar(r12.warnings).indexOf('aralik-turev') !== -1 && kodlar(r12.warnings).indexOf('aralik-tasima') !== -1 && r12.rows.length > 0);
var r13 = coz({ expr: '1/x', x0: '0' });
kontrol('1/x, x0 = 0 → "' + (r13 && r13.errors[0] ? r13.errors[0].message : '?') + '"', r13 && r13.stopReason === 'tanimsiz', r13 && r13.stopReason);
var r14 = coz({ expr: '-x', x0: '1', nmax: '20' });
kontrol('g(x) = −x salınım → Nmax aşıldı uyarısı, son değer var', r14.stopReason === 'nmax' &&
  kodlar(r14.warnings).indexOf('nmax') !== -1 && r14.root !== null && r14.iterations === 20);
var r15 = coz({ expr: 'x = cos(x)', x0: '0.5' });
kontrol('"x = cos(x)" yazımı kabul ediliyor', r15.converged);
var r16 = coz({ expr: 'cbrt(x+2)', x0: '1' });
kontrol('cbrt ile de aynı kök', r16.converged && Math.abs(r16.root - kok3) < 1e-6);

console.log('\nSonuç: ' + gecen + ' geçti, ' + kalan + ' başarısız.');
process.exit(kalan === 0 ? 0 : 1);
