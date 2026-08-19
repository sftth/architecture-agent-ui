import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
// 화면의 거의 모든 문구가 한글이다. 한글용 웹폰트가 없으면 라틴만 Plex로 그려지고
// 한글은 OS 기본 고딕으로 떨어져 같은 문장 안에서 두 서체가 섞인다.
// 굵기는 본문 400과 이름표 600 둘만 쓴다. 한글 웹폰트는 한 굵기가 500KB이므로
// unicode-range로 잘린 기본 CSS를 써서 화면에 실제로 뜬 글자의 조각만 받아오게 한다.
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
