# Sabit Nokta İterasyonu

Sayısal Analiz dersi projesi. Bu web uygulaması, `x = g(x)` veya `f(x) = 0` biçiminde serbest metinle girilen bir denklemi sabit nokta iterasyonu (`x_{k+1} = g(x_k)`) ile çözer. Her adımı AtoZmath benzeri bir tabloda gösterir ve yakınsamayı örümcek ağı (cobweb) diyagramıyla görselleştirir.

## Nasıl açılır?

`index.html` dosyasına çift tıklamanız yeterli. Kurulum, derleme veya internet gerekmez. math.js, KaTeX ve yazı tipleri proje klasöründen yüklenir. Klasör yapısını bozmadan açın.

Hesap çekirdeğinin testlerini çalıştırmak için (Node.js gerekir, başka bağımlılık yok):

```
node tests/solver.test.js
```

## Özellikler

- **Girdiler:** denklem biçimi (`x = g(x)` / `f(x) = 0`), fonksiyon metni, başlangıç değeri `x₀` veya `[a, b]` aralığı (bu durumda `x₀ = (a+b)/2`), tolerans `ε` ve `Nmax`.
- **İfade yazımı:** üs için `^`, doğal log için `ln(x)`, örtük çarpma (`2x`), `sin, cos, tan, exp, ln, log10, sqrt, cbrt, abs…` fonksiyonları, `e` ve `pi` sabitleri. Sayı kutularında ondalık ayırıcı olarak nokta da virgül de kullanılabilir.
- **f(x) = 0 modu:** `g(x) = x − f(x)` alınır. Bu seçim çoğu f için yakınsamaz; uygulama bunu açıkça belirtir ve denklemi kendiniz `x = g(x)` biçimine dönüştürmenizi önerir.
- **Çıktı:** iterasyon tablosu (k, x_k, g(x_k), hata, |g′(x_k)|), toplam adım sayısı, bulunan kök, son hata ve durma nedenini gösteren sonuç kutusu. Formüller KaTeX ile gösterilir.
- **Uyarılar:** sözdizimi hatası, bilinmeyen değişken/fonksiyon, geçersiz sayılar, `a ≥ b`, `ε ≤ 0`, geçersiz `Nmax`, NaN/∞, `|x| > 10¹²` (ıraksama), karmaşık sonuç ("g(x) bu noktada gerçek değil"), `|g′(x_k)| ≥ 1` olan adımlar, art arda büyüyen hata ve Nmax'a ulaşılması. Aralık modunda ayrıca max|g′| ve g([a,b]) ⊆ [a,b] koşulu örneklemeyle kontrol edilir. Bu koşullar sağlanmasa da hesap yapılır, yalnızca uyarı gösterilir.
- **Ekstralar:** cobweb diyagramı (Canvas, kütüphanesiz), panoya kopyalama, Excel'in Türkçe ayarında doğrudan açılan CSV (`;` ayraç, UTF-8 BOM), açık/koyu tema.

## Klasör yapısı

```
index.html            Sayfa iskeleti
style.css             Görünüm (açık/koyu tema, yerleşim)
app.js                Arayüz: girdileri toplar, sonucu çizer, tema, kopyala/CSV
solver.js             Hesap çekirdeği: saf FixedPoint.solve(params, math) fonksiyonu
cobweb.js             Örümcek ağı diyagramı (Canvas)
tests/solver.test.js  Node.js testleri
vendor/mathjs/        math.js 13.2.0 (ifade ayrıştırma, sembolik türev)
vendor/katex/         KaTeX 0.16.11 (formül gösterimi) ve fontları
fonts/                Source Serif 4 (SIL OFL)
```

## Hesap çekirdeği (Python'a taşımak için)

`solver.js` DOM'a dokunmaz ve istisna fırlatmaz. Girdi olarak bir parametre nesnesi alır, çıktı olarak düz bir sonuç nesnesi döndürür:

```js
FixedPoint.solve({
  mode: 'g',            // 'g' → x = g(x), 'f' → f(x) = 0
  expr: 'cos(x)',
  startMode: 'x0',      // 'x0' veya 'interval'
  x0: '0.5', a: '', b: '',
  tol: '1e-6', nmax: '100'
}, math)
// → { ok, errors[], warnings[], notes[], rows[{k, x, gx, error, absDg}],
//     stopReason, converged, root, iterations, lastError, interval, ... }
```

İşlem sırası: ifadeyi normalleştir → ayrıştır ve doğrula → g ile g′'yi kur → aralığı analiz et → iterasyonu yap → sonuç nesnesini döndür. Python sürümünde math.js'in yerini `sympy` alabilir (`sympify`, `diff`, `lambdify`).

## Tablo gösterimi hakkında

Tablonun k. satırı `x_k`, `g(x_k)` (yani `x_{k+1}`) değerlerini ve `|x_k − x_{k−1}|` hatasını gösterir. Bu, ödevdeki `|x_{k+1} − x_k|` ölçütünün bir indis kaydırılmış hâlidir. `k = 0` satırında önceki değer olmadığından hata sütununda "—" yazar. Hata `ε`'dan küçük olduğunda durulur ve `x_k` kök olarak verilir.
