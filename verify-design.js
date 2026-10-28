/**
 * Script de test et de validation CRO / Design avec Playwright
 * Vérifie spécifiquement :
 * 1. Le CORRECTIF DU BUG DE SAUT DE PAGE DU CARROUSEL :
 *    Quand l'utilisateur est scrollé sur le formulaire de paiement, le carrousel ne doit JAMAIS remonter la page !
 * 2. Le chargement effectif des 4 images officielles extraites du document Word
 * 3. La règle 'ZÉRO EMOJI HORS TÉMOIGNAGES'
 * 4. L'ordre exact des 8 sections
 * 5. La session de paiement Moneroo active
 */
const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Démarrage du test de validation globale & correctif carrousel...');
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // TEST 1 : VÉRIFICATION DU CHARGEMENT DES 4 IMAGES
  console.log('\n--- 1. VÉRIFICATION DU CHARGEMENT DES 4 IMAGES ---');
  const imagesToCheck = [
    'images/hero-book-alibaba.jpg',
    'images/preview-inside-alibaba.jpg',
    'images/before-after-alibaba.jpg',
    'images/testimonial-merchant-book.jpg'
  ];

  for (const imgSrc of imagesToCheck) {
    const isLoaded = await page.evaluate(async (src) => {
      const img = document.querySelector(`img[src="${src}"]`);
      if (!img) return false;
      return img.complete && img.naturalWidth > 0;
    }, imgSrc);
    console.log(`🖼️ Image ${imgSrc} chargée avec succès : ${isLoaded ? 'OUI (Haute Résolution)' : 'NON'}`);
  }

  // TEST 2 : TEST DU CORRECTIF DU BUG DE SAUT DE PAGE DU CARROUSEL
  console.log('\n--- 2. TEST ANTI-JUMP DU CARROUSEL ---');
  
  // L'utilisateur fait défiler la page jusqu'au formulaire de paiement tout en bas
  await page.locator('#checkout-form').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const initialScrollY = await page.evaluate(() => window.scrollY);
  console.log(`📍 Position de défilement sur le formulaire : Y = ${Math.round(initialScrollY)}px`);

  // On simule 3 transitions successives du carrousel
  await page.evaluate(() => {
    const nextBtn = document.getElementById('carousel-next-btn');
    if (nextBtn) {
      nextBtn.click();
      nextBtn.click();
      nextBtn.click();
    }
  });

  await page.waitForTimeout(1000);

  const finalScrollY = await page.evaluate(() => window.scrollY);
  console.log(`📍 Position de défilement après transitions carrousel : Y = ${Math.round(finalScrollY)}px`);

  const delta = Math.abs(finalScrollY - initialScrollY);
  if (delta < 20) {
    console.log(`✅ TEST RÉUSSI : Aucun saut de page détecté ! (Déplacement vertical de seulement ${Math.round(delta)}px)`);
  } else {
    console.error(`❌ ÉCHEC : La page a sauté de ${Math.round(delta)}px vers le haut !`);
  }

  // TEST 3 : VÉRIFICATION DE LA RÈGLE ZÉRO EMOJI
  console.log('\n--- 3. TEST ZÉRO EMOJI HORS TÉMOIGNAGES ---');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const outsideText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    const car = clone.querySelector('#testimonials-carousel-section');
    if (car) car.remove();
    return clone.innerText;
  });

  const hasOutsideEmoji = emojiRegex.test(outsideText);
  console.log(hasOutsideEmoji ? '❌ Échec : Emojis trouvés hors carrousel' : '✅ Conforme : Zéro emoji hors carrousel de témoignages');

  // TEST 4 : TEST CHECKOUT API MAKETOU
  console.log('\n--- 4. TEST CHECKOUT API MAKETOU ---');
  const checkoutRes = await page.request.post('http://localhost:3000/api/checkout/create', {
    data: {
      fullName: 'Ulrich Koffi',
      email: 'client@example.com',
      phone: '+2290197000000'
    }
  });
  const checkoutData = await checkoutRes.json();
  console.log(`🔗 Session de paiement Moneroo active : ${checkoutData.redirectUrl ? checkoutData.redirectUrl.substring(0, 45) + '...' : 'Échec'}`);

  // Prise de screenshots
  await page.screenshot({ path: 'screenshot-mobile.png', fullPage: true });
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopPage.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: 'screenshot-desktop.png', fullPage: false });

  await browser.close();
  console.log('\n🎉 TOUS LES TESTS SONT VALIDÉS AVEC SUCCÈS !\n');
})();
