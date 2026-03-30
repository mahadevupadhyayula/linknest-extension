import { useState } from "react";

export default function Popup() {
  const [status, setStatus] = useState("Idle");

  const handleClick = () => {
    console.log("Button clicked");
    setStatus("Working...");
  };

  return (
    <div style={{ padding: "12px", width: "220px", fontFamily: "Arial" }}>
      <h3>LinkNest</h3>

      <button onClick={handleClick}>
        Test Button
      </button>

      <p>Status: {status}</p>
    </div>
  );
}