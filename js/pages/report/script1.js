document.querySelectorAll("nav a").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll("nav a").forEach(i => i.classList.remove("active"));
    item.classList.add("active");
  });
});