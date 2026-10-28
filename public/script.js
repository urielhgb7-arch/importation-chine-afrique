/**
 * Frontend Script : Simulateur de marge d'importation, carrousel interactif SANS jump de page,
 * lecteur vidéo 20s, accordéon FAQ, toasts et formulaire de paiement Maketou.
 */

document.addEventListener('DOMContentLoaded', () => {

  // 1. SIMULATEUR INTERACTIF DE MARGE D'IMPORTATION
  const slider = document.getElementById('sim-slider');
  const qtyDisplay = document.getElementById('sim-qty-display');
  const localCostDisplay = document.getElementById('local-cost-display');
  const alibabaCostDisplay = document.getElementById('alibaba-cost-display');
  const savingsDisplay = document.getElementById('savings-display');

  const LOCAL_UNIT_PRICE = 3500; // Coût chez le grossiste local (marché)
  const ALIBABA_UNIT_PRICE = 850; // Coût Direct Usine Alibaba transport cargo inclus

  function updateSimulation() {
    if (!slider) return;
    const qty = parseInt(slider.value, 10);
    const localTotal = qty * LOCAL_UNIT_PRICE;
    const alibabaTotal = qty * ALIBABA_UNIT_PRICE;
    const savings = localTotal - alibabaTotal;

    qtyDisplay.textContent = `${qty} articles`;
    localCostDisplay.textContent = `${localTotal.toLocaleString('fr-FR')} FCFA`;
    alibabaCostDisplay.textContent = `${alibabaTotal.toLocaleString('fr-FR')} FCFA`;
    savingsDisplay.textContent = `+${savings.toLocaleString('fr-FR')} FCFA dès votre 1er carton !`;
  }

  if (slider) {
    slider.addEventListener('input', updateSimulation);
    updateSimulation();
  }

  // 2. CARROUSEL INTERACTIF DES TÉMOIGNAGES (CORRECTIF STRICT DU JUMP DE PAGE)
  const track = document.getElementById('carousel-track');
  const prevBtn = document.getElementById('carousel-prev-btn');
  const nextBtn = document.getElementById('carousel-next-btn');
  const counterDisplay = document.getElementById('carousel-counter-display');
  const dotsContainer = document.getElementById('carousel-dots-container');
  const carouselSection = document.getElementById('testimonials-carousel-section');

  if (track) {
    const slides = Array.from(track.querySelectorAll('.carousel-slide'));
    const totalSlides = slides.length;
    let currentIndex = 0;
    let autoScrollInterval = null;
    let isUserInteracting = false;
    let isCarouselVisible = false;

    // Création des points de pagination
    slides.forEach((_, idx) => {
      const dot = document.createElement('button');
      dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
      dot.setAttribute('aria-label', `Aller au témoignage ${idx + 1}`);
      dot.addEventListener('click', () => {
        goToSlide(idx);
        resetAutoScroll();
      });
      dotsContainer.appendChild(dot);
    });

    const dots = Array.from(dotsContainer.querySelectorAll('.carousel-dot'));

    function updateCarouselUI(index) {
      currentIndex = index;
      if (counterDisplay) {
        counterDisplay.textContent = `Diapositive ${index + 1} sur ${totalSlides}`;
      }
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === index);
      });
    }

    /**
     * DÉFILEMENT STRICTEMENT INTERNE AU CONTENEUR TRACK
     * Règle absolue anti-jump : INTERDICTION d'utiliser targetSlide.scrollIntoView()
     * car scrollIntoView fait sauter toute la fenêtre du navigateur vers le haut !
     */
    function goToSlide(index) {
      if (index < 0) index = 0;
      if (index >= totalSlides) index = totalSlides - 1;
      const targetSlide = slides[index];
      if (targetSlide && track) {
        const trackRect = track.getBoundingClientRect();
        const slideRect = targetSlide.getBoundingClientRect();
        const targetScrollLeft = track.scrollLeft + (slideRect.left - trackRect.left);
        
        // Défilement horizontal interne sans aucun impact sur la position verticale de la page
        track.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
        updateCarouselUI(index);
      }
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const nextIdx = (currentIndex - 1 + totalSlides) % totalSlides;
        goToSlide(nextIdx);
        resetAutoScroll();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const nextIdx = (currentIndex + 1) % totalSlides;
        goToSlide(nextIdx);
        resetAutoScroll();
      });
    }

    // Détection du swipe tactile manuel
    track.addEventListener('scroll', () => {
      const scrollPos = track.scrollLeft;
      const slideWidth = slides[0].offsetWidth + 20;
      const approximateIndex = Math.round(scrollPos / slideWidth);
      if (approximateIndex !== currentIndex && approximateIndex >= 0 && approximateIndex < totalSlides) {
        updateCarouselUI(approximateIndex);
      }
    });

    // IntersectionObserver : Ne faire défiler le carrousel QUE s'il est réellement visible à l'écran !
    if ('IntersectionObserver' in window && carouselSection) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          isCarouselVisible = entry.isIntersecting;
        });
      }, { threshold: 0.25 });
      observer.observe(carouselSection);
    } else {
      isCarouselVisible = true;
    }

    function startAutoScroll() {
      if (autoScrollInterval) clearInterval(autoScrollInterval);
      autoScrollInterval = setInterval(() => {
        // Condition stricte : L'utilisateur n'interagit pas ET le carrousel est visible
        if (!isUserInteracting && isCarouselVisible) {
          const nextIdx = (currentIndex + 1) % totalSlides;
          goToSlide(nextIdx);
        }
      }, 4500);
    }

    function resetAutoScroll() {
      clearInterval(autoScrollInterval);
      startAutoScroll();
    }

    // Pause au survol ou toucher
    track.addEventListener('mouseenter', () => { isUserInteracting = true; });
    track.addEventListener('mouseleave', () => { isUserInteracting = false; });
    track.addEventListener('touchstart', () => { isUserInteracting = true; }, { passive: true });
    track.addEventListener('touchend', () => {
      setTimeout(() => { isUserInteracting = false; }, 2500);
    });

    startAutoScroll();
  }

  // 3. LECTEUR VIDÉO VERTICAL 9:16 (CLIPS 1 & 2 DÉTAILLÉS)
  const videoOverlay = document.getElementById('video-overlay-trigger');
  const videoElement = document.getElementById('ugc-video-element');
  const clip1 = document.querySelector('.caption-line.clip1');
  const clip2 = document.querySelector('.caption-line.clip2');

  if (videoOverlay && clip1 && clip2) {
    videoOverlay.addEventListener('click', () => {
      const toggleText = videoOverlay.querySelector('.video-sound-toggle span');
      if (videoElement) {
        if (videoElement.paused) {
          videoElement.muted = false;
          videoElement.play().catch(e => console.log('Autoplay audio blocked:', e));
          if (toggleText) toggleText.textContent = "Lecture en cours avec le son";
        } else {
          videoElement.pause();
          if (toggleText) toggleText.textContent = "Relancer la vidéo";
        }
      }
      
      clip1.classList.add('active');
      clip2.classList.remove('active');

      setTimeout(() => {
        clip1.classList.remove('active');
        clip2.classList.add('active');
      }, 5000);
    });
  }

  // 4. ACCORDÉON FAQ ANTI-OBJECTIONS
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      faqItems.forEach(i => i.classList.remove('open'));
      if (!isOpen) {
        item.classList.add('open');
      }
    });
  });

  // 5. SOUMISSION DU FORMULAIRE DE PAIEMENT EXPRESS DIRECT (0 CLIC)
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return '';
  }

  const form = document.getElementById('express-checkout-form');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = submitBtn ? submitBtn.querySelector('.btn-text') : null;
  const btnSpinner = submitBtn ? submitBtn.querySelector('.btn-spinner') : null;

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fullName = document.getElementById('fullName').value.trim();
      const email = document.getElementById('email').value.trim();
      const countryCode = document.getElementById('country-code').value.trim();
      const localPhone = document.getElementById('phone').value.trim();

      if (!fullName || !email || !localPhone) {
        alert("Veuillez renseigner tous les champs requis.");
        return;
      }

      // Nettoyage strict et formatage international (+229...)
      const rawDigits = (countryCode + localPhone).replace(/[^0-9]/g, '');
      const fullPhone = `+${rawDigits}`;

      submitBtn.disabled = true;
      if (btnText) btnText.style.display = 'none';
      if (btnSpinner) btnSpinner.style.display = 'inline-block';

      try {
        const payload = {
          fullName,
          email,
          phone: fullPhone,
          fbp: getCookie('_fbp'),
          fbc: getCookie('_fbc')
        };

        const res = await fetch('/api/checkout/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        // REDIRECTION EXCLUSIVEMENT VERS LA VRAIE URL MONEROO RETOURNÉE PAR MAKETOU
        if (data.success && data.redirectUrl) {
          window.location.href = data.redirectUrl;
        } else {
          alert(data.error || "Une erreur est survenue lors de l'initialisation du paiement.");
          submitBtn.disabled = false;
          if (btnText) btnText.style.display = 'inline-flex';
          if (btnSpinner) btnSpinner.style.display = 'none';
        }
      } catch (err) {
        console.error(err);
        alert("Erreur de connexion avec le serveur de paiement. Veuillez vérifier votre connexion.");
        submitBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline-flex';
        if (btnSpinner) btnSpinner.style.display = 'none';
      }
    });
  }

  // 6. NOTIFICATIONS FLOTTANTES DE PREUVE SOCIALE (ZÉRO EMOJI)
  const socialToast = document.getElementById('social-toast');
  const toastName = document.getElementById('toast-name');
  const toastAction = document.getElementById('toast-action');
  const toastTime = document.getElementById('toast-time');

  const buyers = [
    { name: "Marc A. (Cotonou)", method: "MTN MoMo", time: "Il y a 2 minutes" },
    { name: "Awa D. (Abidjan)", method: "Wave", time: "Il y a 5 minutes" },
    { name: "Ousmane N. (Dakar)", method: "Wave", time: "Il y a 8 minutes" },
    { name: "Clarisse T. (Douala)", method: "Orange Money", time: "Il y a 3 minutes" },
    { name: "Koffi M. (Lomé)", method: "Moov Money", time: "Il y a 11 minutes" },
    { name: "Salif B. (Ouagadougou)", method: "Orange Money", time: "Il y a 6 minutes" }
  ];

  let buyerIndex = 0;

  function showSocialToast() {
    if (!socialToast || !toastName) return;
    const buyer = buyers[buyerIndex % buyers.length];
    buyerIndex++;

    toastName.textContent = buyer.name;
    if (toastAction) toastAction.textContent = `vient d'accéder au guide via ${buyer.method}`;
    if (toastTime) toastTime.textContent = buyer.time;

    socialToast.classList.add('visible');

    setTimeout(() => {
      socialToast.classList.remove('visible');
    }, 4500);
  }

  setTimeout(() => {
    showSocialToast();
    setInterval(showSocialToast, 11000);
  }, 4000);

});
