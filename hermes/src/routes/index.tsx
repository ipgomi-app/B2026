import { createFileRoute } from "@tanstack/react-router";
import { HermesConsole } from "@/components/hermes/console";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <HermesConsole />;
}
