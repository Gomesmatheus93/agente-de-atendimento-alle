import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@atendimento-academias/api/router";

export const trpc = createTRPCReact<AppRouter>();

export type SaidaApi = inferRouterOutputs<AppRouter>;

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: import.meta.env.VITE_API_URL,
      }),
    ],
  });
}
