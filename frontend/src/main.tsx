import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Tooltip from "./components/Tooltip";
// 웹폰트는 싣지 않는다. 라틴을 IBM Plex로, 한글을 Plex Sans KR로 그리던 때는
// 10~11px 마이크로 라벨과 굵은 mono 대문자가 윈도우에서 힌팅을 못 받아 번졌다.
// Segoe UI / Malgun Gothic / Consolas는 이 화면이 도는 OS가 그 크기에 맞춰
// 힌팅해 둔 서체라 같은 자리에서 또렷하다 — 서체 지정은 styles/tokens.css에 있다.
import "./styles/tokens.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {/* title 을 가로채 앱 안에서 그리는 툴팁. 화면 어디의 title 이든 이 하나가 맡는다. */}
    <Tooltip />
  </React.StrictMode>
);
