const HERO_ILLUSTRATION = `<svg viewBox="0 0 420 380" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="heroBlob" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="heroShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#00332a" flood-opacity="0.25"/>
    </filter>
  </defs>
  <ellipse cx="210" cy="345" rx="120" ry="16" fill="#00332a" opacity="0.15"/>
  <circle cx="210" cy="180" r="160" fill="url(#heroBlob)"/>
  <rect x="165" y="270" width="90" height="18" rx="9" fill="#006b56"/>
  <rect x="180" y="286" width="10" height="40" rx="5" fill="#006b56"/>
  <rect x="230" y="286" width="10" height="40" rx="5" fill="#006b56"/>
  <g filter="url(#heroShadow)">
    <path d="M175 275 q0 -40 35 -40 q35 0 35 40 z" fill="#3b4a6b"/>
    <rect x="178" y="170" width="64" height="90" rx="26" fill="#5b6ee1"/>
    <path d="M232 178 q30 4 32 48 q1 16 -18 16 q-16 0 -14 -16 q2 -30 0 -48 z" fill="#4a5cc9"/>
    <path d="M182 190 q-20 14 -14 44 q2 10 12 10 q9 0 9 -10 q-3 -22 -7 -44 z" fill="#4a5cc9"/>
    <rect x="200" y="140" width="20" height="20" rx="8" fill="#f2b787"/>
    <circle cx="210" cy="122" r="30" fill="#f6c79c"/>
    <path d="M180 116 a30 30 0 0 1 60 0 q-30 -14 -60 0z" fill="#00a884"/>
    <rect x="179" y="112" width="62" height="10" rx="5" fill="#008069"/>
    <circle cx="200" cy="124" r="3" fill="#00332a"/>
    <circle cx="220" cy="124" r="3" fill="#00332a"/>
    <path d="M201 134 q9 7 18 0" stroke="#00332a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>
  <g filter="url(#heroShadow)">
    <rect x="248" y="220" width="34" height="54" rx="8" fill="#0b141a"/>
    <rect x="252" y="228" width="26" height="38" rx="3" fill="#06cf9c"/>
    <rect x="256" y="234" width="14" height="4" rx="2" fill="#ffffff"/>
    <rect x="256" y="242" width="18" height="4" rx="2" fill="#ffffff"/>
    <circle cx="271" cy="255" r="3" fill="#ffffff"/>
  </g>
  <g class="float-a">
    <path filter="url(#heroShadow)" fill="#ffffff" d="M300 90 h48 a12 12 0 0 1 12 12 v22 a12 12 0 0 1 -12 12 h-26 l-14 12 l2 -12 h-10 a12 12 0 0 1 -12 -12 v-22 a12 12 0 0 1 12 -12 z"/>
    <circle cx="316" cy="112" r="3.2" fill="#00a884"/>
    <circle cx="328" cy="112" r="3.2" fill="#00a884"/>
    <circle cx="340" cy="112" r="3.2" fill="#00a884"/>
  </g>
  <g class="float-b">
    <circle cx="88" cy="120" r="22" fill="#ffffff" filter="url(#heroShadow)"/>
    <path d="M79 121 l6 6 l14 -14" stroke="#00a884" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g class="float-c">
    <path filter="url(#heroShadow)" fill="#eafff8" d="M66 220 h34 a9 9 0 0 1 9 9 v16 a9 9 0 0 1 -9 9 h-16 l-10 9 l1.4 -9 h-8.4 a9 9 0 0 1 -9 -9 v-16 a9 9 0 0 1 9 -9 z"/>
  </g>
</svg>`;

const DUO_ILLUSTRATION = `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="duoShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#00332a" flood-opacity="0.25"/>
    </filter>
  </defs>
  <ellipse cx="120" cy="200" rx="55" ry="10" fill="#00332a" opacity="0.12"/>
  <ellipse cx="250" cy="200" rx="55" ry="10" fill="#00332a" opacity="0.12"/>
  <g filter="url(#duoShadow)">
    <path d="M90 195 q0 -32 30 -32 q30 0 30 32 z" fill="#2d3f8f"/>
    <rect x="94" y="110" width="52" height="72" rx="22" fill="#5b6ee1"/>
    <path d="M140 122 q22 6 20 34 q-1 10 -12 10 q-10 0 -9 -10 z" fill="#4a5cc9"/>
    <circle cx="120" cy="88" r="24" fill="#f6c79c"/>
    <path d="M96 82 a24 24 0 0 1 48 0 q-24 -11 -48 0z" fill="#ff9f6b"/>
    <circle cx="112" cy="90" r="2.6" fill="#00332a"/>
    <circle cx="128" cy="90" r="2.6" fill="#00332a"/>
    <path d="M112 98 q8 6 16 0" stroke="#00332a" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <g filter="url(#duoShadow)">
    <path d="M220 195 q0 -32 30 -32 q30 0 30 32 z" fill="#006b56"/>
    <rect x="224" y="110" width="52" height="72" rx="22" fill="#06cf9c"/>
    <path d="M224 122 q-22 6 -20 34 q1 10 12 10 q10 0 9 -10 z" fill="#00a884"/>
    <path d="M247 131 q3 11 0 17 q-3 -6 0 -17z M253 131 q-3 11 0 17 q3 -6 0 -17z" fill="#f4c430"/>
    <circle cx="250" cy="129" r="3.4" fill="#f4c430"/>
    <circle cx="250" cy="85" r="28" fill="#e8ab7a"/>
    <ellipse cx="240" cy="72" rx="10" ry="6" fill="#ffffff" opacity="0.22"/>
    <circle cx="240" cy="88" r="2.6" fill="#00332a"/>
    <circle cx="260" cy="88" r="2.6" fill="#00332a"/>
    <path d="M240 97 q10 7 20 0" stroke="#00332a" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <g filter="url(#duoShadow)" class="float-a">
    <path fill="#ffffff" d="M140 40 h80 a16 16 0 0 1 16 16 v28 a16 16 0 0 1 -16 16 h-20 l-16 14 l2 -14 h-44 a16 16 0 0 1 -16 -16 v-28 a16 16 0 0 1 16 -16 z"/>
    <path d="M162 66 l8 8 l16 -16" stroke="#00a884" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

document.getElementById('hero-illustration').innerHTML = HERO_ILLUSTRATION;
document.getElementById('duo-illustration').innerHTML = DUO_ILLUSTRATION;
document.getElementById('footer-year').textContent = new Date().getFullYear();

renderIcons();
renderLogos();
applyI18n();

const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  }
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

const _origSetLangLanding = setLang;
setLang = function (lang) {
  _origSetLangLanding(lang);
};
