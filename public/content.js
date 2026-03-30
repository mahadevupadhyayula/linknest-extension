console.log("LinkNest content script loaded");

// Wait for full page load (IMPORTANT for LinkedIn)
window.addEventListener("load", () => {
  setTimeout(() => {
    injectPanel();
  }, 2000); // delay helps LinkedIn render fully
});

function injectPanel() {
  if (document.getElementById("linknest-panel")) return;

  const panel = document.createElement("div");
  panel.id = "linknest-panel";

  panel.style.position = "fixed";
  panel.style.top = "120px";
  panel.style.right = "20px";
  panel.style.width = "260px";
  panel.style.background = "white";
  panel.style.border = "2px solid red"; // 👈 TEMP DEBUG BORDER
  panel.style.borderRadius = "10px";
  panel.style.padding = "12px";
  panel.style.zIndex = "999999"; // 👈 VERY HIGH
  panel.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
  panel.style.fontFamily = "Arial";

  panel.innerHTML = `
    <h4>LinkNest Copilot</h4>
    <button id="ln-track-btn">Track Person</button><br/><br/>
    <button id="ln-suggest-btn">Suggest Comment</button>
  `;

  document.body.appendChild(panel);

  console.log("LinkNest panel injected");
}