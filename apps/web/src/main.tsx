import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Toaster, toast } from "./components/ui/Toast.js";
import { createTrpcClient, trpc } from "./lib/trpc.js";
import "./styles/index.css";

const INTERVALO_AVISO_ERRO_MS = 15_000;
let ultimoAvisoDeErro = 0;

function criarQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (erro) => {
        // Sessão perdida ou expirada: o App volta para o login assim que reler o estado.
        if ((erro as { data?: { code?: string } }).data?.code === "UNAUTHORIZED") {
          void queryClient.invalidateQueries({ queryKey: [["auth", "estado"]] });
          return;
        }
        // Um aviso por vez: com a API fora do ar, várias consultas falham juntas e em repetição.
        if (Date.now() - ultimoAvisoDeErro < INTERVALO_AVISO_ERRO_MS) return;
        ultimoAvisoDeErro = Date.now();
        toast.erro("Não foi possível carregar os dados. Verifique se a API está no ar.");
      },
    }),
    defaultOptions: { queries: { retry: 1, staleTime: 2000 } },
  });
  return queryClient;
}

function Root() {
  const [queryClient] = useState(criarQueryClient);
  const [trpcClient] = useState(() => createTrpcClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
