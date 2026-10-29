/**
 * Script Compact Format Court (2 Coups de Pouce) :
 * - Défilement fluide instantané vers le formulaire & focus sur le champ Nom
 * - Lecteur vidéo 20s avec lecture audio débloquée
 * - Accordéon pliable du sommaire
 * - Défilement horizontal fluide des avis sans aucun impact vertical
 * - Connexion API Maketou
 */

document.addEventListener('DOMContentLoaded', () => {

  // 0. COMPTE À REBOURS OFFRE FLASH (15 MINUTES DÉGRESSIVES PERSISTANTES)
  const countdownDisplay = document.getElementById('top-countdown-display');
  if (countdownDisplay) {
    const STORAGE_KEY = 'flash_offer_timer_end';
    let endTime = parseInt(sessionStorage.getItem(STORAGE_KEY), 10);
    const DURATION_SECONDS = 14 * 60 + 59; // 14 min 59 s

    if (!endTime || isNaN(endTime) || endTime <= Date.now()) {
      endTime = Date.now() + DURATION_SECONDS * 1000;
      sessionStorage.setItem(STORAGE_KEY, endTime.toString());
    }

    function updateCountdown() {
      const now = Date.now();
      let diff = Math.max(0, Math.floor((endTime - now) / 1000));

      if (diff <= 0) {
        // Extension de secours de 4m59s pour maintenir la pression de conversion
        endTime = Date.now() + (4 * 60 + 59) * 1000;
        sessionStorage.setItem(STORAGE_KEY, endTime.toString());
        diff = 4 * 60 + 59;
      }

      const minutes = Math.floor(diff / 60);
      const seconds = diff % 60;
      const minStr = minutes < 10 ? '0' + minutes : String(minutes);
      const secStr = seconds < 10 ? '0' + seconds : String(seconds);

      countdownDisplay.textContent = `${minStr}:${secStr}`;
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  // 1. DÉFILEMENT INSTANTANÉ VERS LE FORMULAIRE & FOCUS SUR NOM (0.3s)
  const scrollBtns = document.querySelectorAll('.js-scroll-to-checkout, a[href="#checkout-form"]');
  const checkoutSection = document.getElementById('checkout-form');
  const nameInput = document.getElementById('fullName');

  scrollBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (checkoutSection) {
        checkoutSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
          if (nameInput) nameInput.focus();
        }, 350);
      }
    });
  });

  // 2. LECTEUR VIDÉO 20S COMPACT (LECTURE AVEC LE SON AU TAP)
  const videoElem = document.getElementById('ugc-video-compact');
  const videoTapBtn = document.getElementById('video-tap-btn');

  if (videoElem && videoTapBtn) {
    videoTapBtn.addEventListener('click', () => {
      if (videoElem.paused) {
        videoElem.muted = false;
        videoElem.play().catch(e => console.log('Audio autoplay blocked:', e));
        videoTapBtn.style.opacity = '0.15';
      } else {
        videoElem.pause();
        videoTapBtn.style.opacity = '1';
      }
    });

    videoElem.addEventListener('click', () => {
      if (videoElem.paused) {
        videoElem.play();
        videoTapBtn.style.opacity = '0.15';
      } else {
        videoElem.pause();
        videoTapBtn.style.opacity = '1';
      }
    });
  }

  // 3. ACCORDÉON COMPACT DU SOMMAIRE (FERMÉ PAR DÉFAUT)
  const accordionBox = document.querySelector('.accordion-compact-box');
  const accordionBtn = document.getElementById('accordion-btn');

  if (accordionBox && accordionBtn) {
    accordionBtn.addEventListener('click', () => {
      const isOpen = accordionBox.classList.contains('open');
      accordionBox.classList.toggle('open');
      const label = accordionBtn.querySelector('span');
      if (label) {
        label.textContent = isOpen 
          ? "Voir le sommaire et l'aperçu des 4 pages (+)" 
          : "Masquer le sommaire et l'aperçu (-)";
      }
    });
  }

  // 4. CARROUSEL COMPACT HORIZONTAL DES AVIS (DÉFILEMENT FLUIDE SANS SAUT DE PAGE)
  const reviewsTrack = document.getElementById('compact-reviews-track');
  if (reviewsTrack) {
    let reviewScrollInterval = null;
    let isInteracting = false;
    let isVisible = false;

    // Détecte si le carrousel est visible à l'écran pour ne JAMAIS perturber la lecture ou le formulaire
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        isVisible = entries[0].isIntersecting;
      }, { threshold: 0.1 });
      observer.observe(reviewsTrack);
    } else {
      isVisible = true;
    }

    function autoScrollReviews() {
      if (reviewScrollInterval) clearInterval(reviewScrollInterval);
      reviewScrollInterval = setInterval(() => {
        if (!isInteracting && isVisible) {
          const maxScroll = reviewsTrack.scrollWidth - reviewsTrack.clientWidth;
          if (reviewsTrack.scrollLeft >= maxScroll - 10) {
            reviewsTrack.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            reviewsTrack.scrollBy({ left: 220, behavior: 'smooth' });
          }
        }
      }, 4000);
    }

    reviewsTrack.addEventListener('mouseenter', () => { isInteracting = true; });
    reviewsTrack.addEventListener('mouseleave', () => { isInteracting = false; });
    reviewsTrack.addEventListener('touchstart', () => { isInteracting = true; }, { passive: true });
    reviewsTrack.addEventListener('touchend', () => {
      setTimeout(() => { isInteracting = false; }, 2000);
    });

    autoScrollReviews();
  }

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

        // Sauvegarde de l'ID panier et commande dans localStorage pour la page /confirmation-achat
        if (data.cartId) {
          try {
            localStorage.setItem('maketou_cart_id', data.cartId);
            if (data.orderId) localStorage.setItem('maketou_order_id', data.orderId);
          } catch (e) {
            console.warn('LocalStorage error:', e);
          }
        }

        // REDIRECTION VERS L'URL DE PAIEMENT RETOURNÉE PAR MAKETOU
        if ((data.success || data.cartId) && data.redirectUrl) {
          if (window.ttq) {
            try {
              ttq.track('InitiateCheckout', {
                content_id: '550dff27-bf7d-4d7b-b997-7cc86bcc6771',
                content_type: 'product',
                content_name: 'Guide Importation Chine-Afrique',
                quantity: 1,
                price: 1500,
                value: 1500,
                currency: 'XOF'
              });
            } catch(e) {}
          }
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

});
