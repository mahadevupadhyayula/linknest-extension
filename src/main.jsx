import React from "react";
import ReactDOM from "react-dom/client";
import Popup from "./Popup";

console.log("POPUP LOADED");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);