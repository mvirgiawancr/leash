import "server-only";
import { cookies } from "next/headers";

export async function userId() {
  const id = (await cookies()).get("leash_uid")?.value;
  if (!id) throw new Error("No session cookie");
  return id;
}
