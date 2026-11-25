import { useEffect, useState } from "react";
import { motionLevel, useSettings } from "../settings";

export function BrandMark({ radar = false }: { radar?: boolean }) {
  const settings = useSettings();
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return (
    <span className={`brand-motion${radar ? " brand-radar" : ""}`}
      data-motion={visible && motionLevel(settings) === "full" ? "on" : "off"} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}icons/online-yacht.svg`} width="30" height="30" alt="" />
    </span>
  );
}
