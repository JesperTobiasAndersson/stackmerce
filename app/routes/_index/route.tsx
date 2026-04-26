import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();

  throw redirect(queryString ? `/app?${queryString}` : "/app");
};

export default function App() {
  return null;
}
