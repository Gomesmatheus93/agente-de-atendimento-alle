import { useLayoutEffect, useRef, useState } from "react";

export function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);

  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;

    setLargura(elemento.clientWidth);
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada) setLargura(Math.floor(entrada.contentRect.width));
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  return { ref, largura };
}
