const lenis = new Lenis({
  lerp: 0.08,
  smoothWheel: true,
  wheelMultiplier: 1,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

if (window.ScrollTrigger) {
  lenis.on("scroll", ScrollTrigger.update);
}

const heroVideo = document.querySelector(".hero-video");
const heroLogo = document.querySelector(".logo");
const brandMark = document.querySelector(".brand-mark");
const scrollCue = document.querySelector(".scroll-cue");
if (brandMark && window.gsap) {
  gsap.to(brandMark, { opacity: 1, duration: 1, delay: 0.4, ease: "power2.out" });
}

if (heroLogo) {
  let revealed = false;
  const revealLogo = () => {
    if (revealed) return;
    revealed = true;
    if (window.gsap) gsap.fromTo(heroLogo, { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power1.out" });
    else heroLogo.style.opacity = 1;
    if (scrollCue) scrollCue.classList.add("show");
  };
  if (heroVideo) {
    heroVideo.addEventListener("ended", revealLogo);
    heroVideo.addEventListener("error", revealLogo);
    const pp = heroVideo.play();
    if (pp && pp.catch) pp.catch(revealLogo);
  } else {
    revealLogo();
  }
}

if (scrollCue) {
  addEventListener("scroll", () => { if (scrollY > 40) scrollCue.classList.remove("show"); }, { passive: true });
}

document.querySelectorAll(".copy-year").forEach((el) => { el.textContent = new Date().getFullYear(); });

if (heroVideo && "IntersectionObserver" in window) {
  const vio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { if (!heroVideo.ended) heroVideo.play().catch(() => {}); }
      else { heroVideo.pause(); }
    });
  }, { threshold: 0.15 });
  vio.observe(heroVideo);
}

const carFxEl = document.querySelector(".car-fx");
if (carFxEl) {

  const pf = document.createElement("link");
  pf.rel = "prefetch";
  pf.href = "models/supra.glb?v=5";
  document.head.appendChild(pf);

  let started = false;
  const loadCarFx = () => {
    if (started) return;
    started = true;
    import("./CarFx.js").catch((e) => console.error("CarFx failed", e));
  };

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { loadCarFx(); io.disconnect(); }
    }, { rootMargin: "2200px 0px" });
    io.observe(carFxEl);
  } else {
    addEventListener("load", loadCarFx);
  }
}
