import { useLocation } from "react-router-dom";

export function useLocale() {
  const { pathname } = useLocation();
  const chinese = pathname === "/zh" || pathname.startsWith("/zh/");
  return {
    chinese,
    prefix: chinese ? "/zh" : "",
    t: (english: string, mandarin: string) => (chinese ? mandarin : english),
  };
}
