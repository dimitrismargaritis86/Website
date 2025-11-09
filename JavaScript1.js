window.addEventListener("wheel", function(e) {

    e.preventDefault();
    window.scrollBy({

        top: e.deltaY * 0.35,
        behavior: "auto"

    });

}, {passive: false});